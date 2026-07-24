import { Logger } from "@nestjs/common";
import { z } from "zod";

import type { AllowlistFetch } from "./http/allowlist-fetch";
import type { TourDTO } from "./normalizer";

/**
 * Location resolver (ST-7b / BRI-163).
 *
 * Viator's product payload does **not** embed coordinates — a tour's start
 * point comes through only as an opaque location reference
 * (`logistics.start[0].location.ref`, e.g. `"LOC-abc123"`, surfaced by the ST-7
 * normalizer as {@link TourDTO.location_ref}). This resolver turns those
 * references into real latitude/longitude by calling Viator's
 * `POST /locations/bulk` endpoint, and attaches the result to the tour so ST-8's
 * geo validation has coordinates to work with.
 *
 * Two properties keep this cheap and safe:
 *
 * - **Cached across runs** — resolved coordinates are persisted through a
 *   {@link LocationCache} keyed by reference. Viator's own guidance is that
 *   location data changes infrequently (refresh monthly), so a reference already
 *   resolved on a previous import is served from cache and never re-fetched.
 * - **SSRF-safe** — every request goes through the same {@link AllowlistFetch}
 *   the ST-6 client uses, locked to the Viator API host.
 *
 * Request/response shape is **verified against the live production API** (Viator
 * product 57189P2 + a 30-product Hanoi sample, 2026-07-24), not just the docs:
 *
 * - Request body is `{ locations: [ref…] }` — confirmed (200 OK, echoed back),
 *   max **500** references per request (more returns `BAD_REQUEST`).
 * - Response is `{ locations: [ … ] }`, each item keyed by `reference`, but its
 *   **shape depends on `provider`**:
 *     - `TRIPADVISOR` (and Viator-native) locations carry a `center` object with
 *       `latitude`/`longitude` (plus `name`/`address`) — the coordinates we want.
 *       This is the dominant case (~28 of 30 in the live sample).
 *     - `GOOGLE`-provider locations carry **no `center`** — only a
 *       `providerReference` (a Google Place ID like `ChIJ…`). Viator does not
 *       return coordinates for these; resolving them would need a separate Google
 *       Places lookup, which is out of scope here. Such references simply resolve
 *       to "no coordinates" and leave the tour's lat/lng `null` (a later story can
 *       resolve Place IDs if it becomes necessary).
 *
 * So a reference not resolving is an expected, structural outcome — not an error.
 */

/** Viator's hard limit: at most 500 references per `/locations/bulk` request. */
export const MAX_LOCATIONS_PER_REQUEST = 500;

/** A resolved location: the reference plus its real-world coordinates. */
export interface ResolvedLocation {
  /** The Viator location reference this resolves, e.g. `"LOC-abc123"`. */
  reference: string;
  /** Latitude in WGS-84 decimal degrees (`center.latitude`). */
  latitude: number;
  /** Longitude in WGS-84 decimal degrees (`center.longitude`). */
  longitude: number;
  /** Location display name, when Viator provides one. */
  name: string | null;
}

/**
 * Persistence seam for resolved locations. The resolver depends on this
 * interface — not on any concrete backend — so unit tests inject an in-memory
 * fake and never touch the database, while production wires a Prisma-backed
 * store. It must **survive across import runs**: a reference resolved yesterday
 * is a cache hit today.
 */
export interface LocationCache {
  /**
   * Look up already-resolved locations. Returns a map keyed by reference,
   * containing only the references that are present in the cache (misses are
   * simply absent).
   */
  getMany(references: string[]): Promise<Map<string, ResolvedLocation>>;
  /** Persist newly-resolved locations (upsert by reference). */
  putMany(locations: ResolvedLocation[]): Promise<void>;
}

/** Config the resolver needs to reach Viator (mirrors the ST-6 client). */
export interface LocationResolverConfig {
  /** Viator API base URL, e.g. `https://api.viator.com/partner`. */
  baseUrl: string;
  /** Viator Partner API key (sent as `exp-api-key`). */
  apiKey: string;
  /** Accept-Language header value, e.g. `en-US`. */
  language: string;
}

/**
 * Schema for the `/locations/bulk` response, matched to the **live** payload. We
 * validate the `locations` array and each item's `reference`, `provider`,
 * `center` (present for coordinate-bearing providers), and `providerReference`
 * (present for `GOOGLE` locations instead of `center`) — and tolerate everything
 * else Viator returns (`address`, etc.). `center` is optional by design: a
 * `GOOGLE` item legitimately has none, so it is dropped by
 * {@link toResolvedLocation} rather than failing the whole batch.
 */
const locationsBulkResponseSchema = z.object({
  locations: z
    .array(
      z
        .object({
          reference: z.string(),
          provider: z.string().optional(),
          providerReference: z.string().optional(),
          name: z.string().optional(),
          center: z
            .object({
              latitude: z.number(),
              longitude: z.number(),
            })
            .optional(),
        })
        // Unknown/extra fields (address, …) are ignored, not rejected.
        .passthrough(),
    )
    .default([]),
});

export class LocationResolver {
  private readonly logger = new Logger(LocationResolver.name);

  constructor(
    private readonly config: LocationResolverConfig,
    private readonly http: AllowlistFetch,
    private readonly cache: LocationCache,
  ) {}

  /**
   * Resolve a set of location references to coordinates. Cache hits are served
   * without hitting the network; only the misses are fetched from Viator, in
   * batches of at most {@link MAX_LOCATIONS_PER_REQUEST}. Input order and
   * duplicates don't matter — the result is a map keyed by reference, holding
   * every reference that resolved (from cache or API). References that Viator
   * cannot resolve are simply absent from the map.
   */
  async resolve(references: string[]): Promise<Map<string, ResolvedLocation>> {
    // Dedupe and drop empties up front so batching/limits count real work.
    const unique = [...new Set(references.filter((r) => r.length > 0))];
    if (unique.length === 0) return new Map();

    const resolved = await this.cache.getMany(unique);
    const misses = unique.filter((ref) => !resolved.has(ref));

    if (misses.length === 0) {
      this.logger.debug(`All ${unique.length} location(s) served from cache`);
      return resolved;
    }

    const fetched: ResolvedLocation[] = [];
    for (const batch of chunk(misses, MAX_LOCATIONS_PER_REQUEST)) {
      fetched.push(...(await this.fetchBatch(batch)));
    }

    // Persist once, then fold the freshly-fetched results into the map so a
    // later reference in the same run is a cache hit next time round.
    if (fetched.length > 0) {
      await this.cache.putMany(fetched);
      for (const loc of fetched) resolved.set(loc.reference, loc);
    }

    return resolved;
  }

  /**
   * Attach resolved coordinates to a batch of tours. Reads each tour's
   * {@link TourDTO.location_ref}, resolves the whole set in one pass (shared
   * cache + batched requests), and returns new DTOs with `latitude`/`longitude`
   * filled in. Tours with no reference, or whose reference does not resolve,
   * come back with coordinates left `null`. Input DTOs are not mutated.
   */
  async attachLocations(tours: TourDTO[]): Promise<TourDTO[]> {
    const refs = tours
      .map((t) => t.location_ref)
      .filter((r): r is string => r !== null);

    const resolved = await this.resolve(refs);

    return tours.map((tour) => {
      const loc = tour.location_ref
        ? resolved.get(tour.location_ref)
        : undefined;
      if (!loc) return { ...tour };
      return { ...tour, latitude: loc.latitude, longitude: loc.longitude };
    });
  }

  /** POST one ≤500 batch to `/locations/bulk` and parse the resolved rows. */
  private async fetchBatch(references: string[]): Promise<ResolvedLocation[]> {
    const url = this.buildUrl();
    const response = await this.http.fetch(url, {
      method: "POST",
      headers: {
        "exp-api-key": this.config.apiKey,
        Accept: "application/json;version=2.0",
        "Accept-Language": this.config.language,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ locations: references }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Viator /locations/bulk failed: ${response.status} ${response.statusText} ${body}`.trim(),
      );
    }

    const parsed = locationsBulkResponseSchema.parse(await response.json());

    const out: ResolvedLocation[] = [];
    for (const item of parsed.locations) {
      const loc = toResolvedLocation(item);
      if (loc) {
        out.push(loc);
        continue;
      }
      // No coordinates. For GOOGLE-provider locations this is expected (Viator
      // returns a Google Place ID, not a center), so log at debug — not warn —
      // to avoid spamming production for a normal, structural case.
      this.logger.debug(
        `Location "${item.reference}" (provider=${item.provider ?? "unknown"}` +
          `${item.providerReference ? `, providerReference=${item.providerReference}` : ""})` +
          ` has no center coordinates; left unresolved`,
      );
    }
    return out;
  }

  /** Build the `/locations/bulk` URL from the configured base. */
  private buildUrl(): URL {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    return new URL(`${base}/locations/bulk`);
  }
}

/**
 * Narrow a parsed response item to a {@link ResolvedLocation}, or `null` when it
 * carries no coordinates (e.g. a `GOOGLE`-provider location, which has a
 * `providerReference` instead of a `center`).
 */
function toResolvedLocation(item: {
  reference: string;
  provider?: string;
  providerReference?: string;
  name?: string;
  center?: { latitude: number; longitude: number };
}): ResolvedLocation | null {
  if (!item.center) return null;
  return {
    reference: item.reference,
    latitude: item.center.latitude,
    longitude: item.center.longitude,
    name: item.name ?? null,
  };
}

/** Split `items` into contiguous chunks of at most `size`. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
