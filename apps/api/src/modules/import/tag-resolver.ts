import { Logger } from "@nestjs/common";

import type { PrismaService } from "../../prisma/prisma.service";
import type { TagGraph } from "./category-rule";
import type { AllowlistFetch } from "./http/allowlist-fetch";

/**
 * Viator tag vocabulary resolver + cache (BRI-224).
 *
 * `/products/tags` (~1,265 tags) is Atlas's only source for tag names and the
 * DAG's `parentTagIds`; `ViatorCatalog.tagNames()` (`modules/research/`) is
 * not reusable here — it discards `parentTagIds` and production ingest must
 * not import from `research/` (AGENTS.md).
 *
 * Unlike `ExchangeRateResolver`'s per-currency-pair cache (each row has its
 * own Viator-supplied `expiry`), Viator gives no per-tag expiry: the whole
 * vocabulary is refreshed **wholesale** — delete + re-insert the full set —
 * once it is older than {@link DEFAULT_STALE_AFTER_MS} (7 days), checked once
 * at import start rather than per page. A refresh that fails is non-fatal: an
 * existing (now-stale) vocabulary is still usable, so a transient Viator
 * outage never blocks a whole import run — it only leaves the vocabulary a
 * little older than usual. A refresh failing with **no** existing vocabulary
 * is logged loudly (every tour's category derivation is a no-op for this run,
 * not a crash).
 */

/** 7 days — Viator gives no per-tag expiry, so Atlas owns this cadence. */
export const DEFAULT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Config the resolver needs to reach Viator (mirrors `exchange-rate-resolver.ts`). */
export interface TagResolverConfig {
  /** Viator API base URL, e.g. `https://api.viator.com/partner`. */
  baseUrl: string;
  /** Viator Partner API key (sent as `exp-api-key`). */
  apiKey: string;
  /** Accept-Language header value, e.g. `en-US`. */
  language: string;
  /** Overrides {@link DEFAULT_STALE_AFTER_MS}; tests only. */
  staleAfterMs?: number;
}

/** One tag's vocabulary row, as stored (and as parsed off the wire). */
export interface CachedTag {
  tagId: number;
  name: string;
  parentTagIds: number[];
}

/** The vocabulary as `getVocabulary()` returns it: ready for `category-rule.ts` and for display. */
export interface TagVocabulary {
  graph: TagGraph;
  names: ReadonlyMap<number, string>;
}

/**
 * Persistence seam for the cached vocabulary. Backed in production by
 * {@link PrismaTagVocabularyCache}; unit tests use an in-memory fake.
 */
export interface TagVocabularyCache {
  loadAll(): Promise<CachedTag[]>;
  /** When the table was last wholesale-refreshed, or `null` if it's empty. */
  lastRefreshedAt(): Promise<Date | null>;
  /** Delete the whole table and re-insert `rows`, all stamped with `fetchedAt`. */
  replaceAll(rows: CachedTag[], fetchedAt: Date): Promise<void>;
}

/**
 * Prisma-backed {@link TagVocabularyCache}, persisting to `ViatorTag`. Every
 * row from one refresh shares a single `fetchedAt`, so the table's own
 * staleness is read off any row rather than tracked in a separate marker.
 */
export class PrismaTagVocabularyCache implements TagVocabularyCache {
  constructor(private readonly prisma: PrismaService) {}

  async loadAll(): Promise<CachedTag[]> {
    const rows = await this.prisma.viatorTag.findMany();
    return rows.map((row) => ({
      tagId: row.tagId,
      name: row.name,
      parentTagIds: row.parentTagIds,
    }));
  }

  async lastRefreshedAt(): Promise<Date | null> {
    const result = await this.prisma.viatorTag.aggregate({
      _max: { fetchedAt: true },
    });
    return result._max.fetchedAt ?? null;
  }

  async replaceAll(rows: CachedTag[], fetchedAt: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.viatorTag.deleteMany({}),
      this.prisma.viatorTag.createMany({
        data: rows.map((row) => ({ ...row, fetchedAt })),
      }),
    ]);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Parse a raw `/products/tags` response into {@link CachedTag} rows. Pure —
 * no I/O, so it's independently testable against a fixture. `name` prefers
 * `allNamesByLocale.en`, falling back to the first available locale; a tag
 * with no usable name at all is skipped (it will simply surface as an
 * unresolved tag id wherever a tour references it — never silently coerced
 * into a fake name). `parentTagIds` defaults to `[]` when absent (a root).
 */
export function parseTagsResponse(raw: unknown): CachedTag[] {
  const list = isRecord(raw) && Array.isArray(raw.tags) ? raw.tags : [];
  const rows: CachedTag[] = [];
  for (const tag of list) {
    if (!isRecord(tag) || typeof tag.tagId !== "number") continue;
    const byLocale = isRecord(tag.allNamesByLocale) ? tag.allNamesByLocale : {};
    const name = byLocale.en ?? Object.values(byLocale)[0];
    if (typeof name !== "string" || name.trim() === "") continue;
    const parentTagIds = Array.isArray(tag.parentTagIds)
      ? tag.parentTagIds.filter((id): id is number => typeof id === "number")
      : [];
    rows.push({ tagId: tag.tagId, name: name.trim(), parentTagIds });
  }
  return rows;
}

/** Build the `tagId → parentTagIds` graph {@link category-rule.ts} walks. */
export function toTagGraph(rows: readonly CachedTag[]): TagGraph {
  return new Map(rows.map((row) => [row.tagId, row.parentTagIds]));
}

function toVocabulary(rows: readonly CachedTag[]): TagVocabulary {
  return {
    graph: toTagGraph(rows),
    names: new Map(rows.map((row) => [row.tagId, row.name])),
  };
}

export class TagResolver {
  private readonly logger = new Logger(TagResolver.name);
  private readonly staleAfterMs: number;

  constructor(
    private readonly config: TagResolverConfig,
    private readonly http: AllowlistFetch,
    private readonly cache: TagVocabularyCache,
  ) {
    this.staleAfterMs = config.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  }

  /**
   * The vocabulary to derive categories from this run. Refreshes wholesale
   * first if the cache is empty or older than {@link staleAfterMs}; otherwise
   * reads the cache as-is. See the class doc comment for the tolerance rules
   * around a failed refresh.
   */
  async getVocabulary(): Promise<TagVocabulary> {
    const lastRefreshedAt = await this.cache.lastRefreshedAt();
    const stale =
      lastRefreshedAt === null ||
      Date.now() - lastRefreshedAt.getTime() > this.staleAfterMs;

    if (!stale) {
      return toVocabulary(await this.cache.loadAll());
    }

    const fetched = await this.fetchTags();
    if (fetched.length > 0) {
      await this.cache.replaceAll(fetched, new Date());
      return toVocabulary(fetched);
    }

    const existing = await this.cache.loadAll();
    if (existing.length > 0) {
      this.logger.warn(
        "Viator tag vocabulary refresh failed or returned nothing; " +
          `continuing with the existing ${existing.length}-tag vocabulary (now stale).`,
      );
      return toVocabulary(existing);
    }

    this.logger.error(
      "Viator tag vocabulary is empty and this run's refresh failed or returned " +
        "nothing — every tour's primaryCategoryTagId will be null this run.",
    );
    return toVocabulary([]);
  }

  /**
   * GET `/products/tags` and parse it. Returns `[]` (never throws) on a
   * network error, non-OK response, or a shape with no usable tags, logging a
   * warning — {@link getVocabulary} decides what to do about an empty result.
   */
  private async fetchTags(): Promise<CachedTag[]> {
    let response: Response;
    try {
      response = await this.http.fetch(this.buildUrl(), {
        method: "GET",
        headers: {
          "exp-api-key": this.config.apiKey,
          Accept: "application/json;version=2.0",
          "Accept-Language": this.config.language,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Viator /products/tags request errored: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.warn(
        `Viator /products/tags failed: ${response.status} ${response.statusText} ${body}`.trim(),
      );
      return [];
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      this.logger.warn("Viator /products/tags returned a body that is not JSON.");
      return [];
    }

    const rows = parseTagsResponse(json);
    if (rows.length === 0) {
      this.logger.warn("Viator /products/tags held no usable tags.");
    }
    return rows;
  }

  /** Build the `/products/tags` URL from the configured base. */
  private buildUrl(): URL {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    return new URL(`${base}/products/tags`);
  }
}
