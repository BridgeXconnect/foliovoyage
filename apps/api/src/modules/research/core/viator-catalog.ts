import * as fs from "node:fs";
import * as path from "node:path";

import { AllowlistFetch, type FetchLike } from "../../import/http/allowlist-fetch";

/**
 * Viator tag names and attractions for the candidate stage (BRI-206, spec
 * child 0003). These are the free Viator partner calls, not the paid search
 * provider. Each raw response is cached on disk under `viator/`, so a rerun
 * makes no call at all.
 *
 * Request and response shapes follow the Viator partner reference for
 * `POST /attractions/search` (`destinationId`, `sorting`, `pagination`; replies
 * carry `attractions[]` with `name`, `productCount`, `reviews.combinedAverageRating`,
 * and `totalCount`). Viator asks that attractions be cached and refreshed
 * weekly, and that pages built from this endpoint are not indexed. This stage
 * only uses the names and counts to pick search queries, and publishes nothing.
 *
 * Calls go through {@link AllowlistFetch} locked to the Viator host. The API
 * key is held in a private field, sent only as the `exp-api-key` header, and
 * redacted from any error text.
 */

const BODY_SNIPPET_CHARS = 200;
const ATTRACTION_PAGE_SIZE = 30;
/** A safety stop on paging, so a misread `totalCount` cannot loop. */
const ATTRACTION_MAX_PAGES = 10;

export class ViatorCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ViatorCatalogError";
  }
}

export interface ViatorCatalogOptions {
  /** `apps/api/research-data`; files land in its `viator/` folder. */
  dataDir: string;
  apiKey: string;
  /** e.g. `https://api.viator.com/partner`. Its host is the only one reachable. */
  baseUrl: string;
  language: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** One attraction as far as this stage reads it. Counts are optional: the spike decides if they exist. */
export interface Attraction {
  name: string;
  productCount?: number;
  ratingAvg?: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export class ViatorCatalog {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #language: string;
  readonly #dir: string;
  readonly #http: AllowlistFetch;

  constructor(options: ViatorCatalogOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#language = options.language;
    this.#dir = path.join(options.dataDir, "viator");
    this.#http = new AllowlistFetch(
      [new URL(this.#baseUrl).host],
      options.fetchImpl ?? fetch,
      options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
    );
  }

  /** Tag id to English name, from one `/products/tags` call cached in `tags.json`. */
  async tagNames(): Promise<Map<number, string>> {
    const raw = await this.#cached("tags.json", () => this.#call("GET", "/products/tags"));
    const list = isRecord(raw) && Array.isArray(raw.tags) ? raw.tags : [];
    const names = new Map<number, string>();
    for (const tag of list) {
      if (!isRecord(tag) || typeof tag.tagId !== "number") continue;
      const byLocale = isRecord(tag.allNamesByLocale) ? tag.allNamesByLocale : {};
      const name = byLocale.en ?? Object.values(byLocale)[0];
      if (typeof name === "string" && name.trim() !== "") names.set(tag.tagId, name.trim());
    }
    if (names.size === 0) {
      throw new ViatorCatalogError(
        "The tags response held no usable tag names. Nothing was ranked. Check research-data/viator/tags.json.",
      );
    }
    return names;
  }

  /** Every attraction for one destination ref, paged, cached raw in `attractions-<ref>.json`. */
  async attractions(destRef: string): Promise<Attraction[]> {
    const raw = await this.#cached(`attractions-${destRef}.json`, async () => {
      const pages: unknown[] = [];
      for (let page = 0; page < ATTRACTION_MAX_PAGES; page++) {
        const body = {
          destinationId: Number(destRef),
          sorting: { sort: "DEFAULT" },
          pagination: { start: page * ATTRACTION_PAGE_SIZE + 1, count: ATTRACTION_PAGE_SIZE },
        };
        const res = await this.#call("POST", "/attractions/search", body);
        pages.push(res);
        const items = isRecord(res) && Array.isArray(res.attractions) ? res.attractions : [];
        const total = isRecord(res) && typeof res.totalCount === "number" ? res.totalCount : 0;
        if (items.length < ATTRACTION_PAGE_SIZE || (page + 1) * ATTRACTION_PAGE_SIZE >= total) break;
      }
      return pages;
    });

    const out: Attraction[] = [];
    for (const page of Array.isArray(raw) ? raw : []) {
      const items = isRecord(page) && Array.isArray(page.attractions) ? page.attractions : [];
      for (const item of items) {
        if (!isRecord(item) || typeof item.name !== "string" || item.name.trim() === "") continue;
        const reviews = isRecord(item.reviews) ? item.reviews : {};
        const count = item.productCount ?? item.numberOfProducts;
        const rating = reviews.combinedAverageRating ?? item.averageRating;
        out.push({
          name: item.name.trim(),
          ...(typeof count === "number" ? { productCount: count } : {}),
          ...(typeof rating === "number" ? { ratingAvg: rating } : {}),
        });
      }
    }
    return out;
  }

  async #cached(file: string, fetchIt: () => Promise<unknown>): Promise<unknown> {
    const full = path.join(this.#dir, file);
    if (fs.existsSync(full)) {
      try {
        return JSON.parse(fs.readFileSync(full, "utf8"));
      } catch {
        throw new ViatorCatalogError(`Cache file ${full} is not valid JSON. Delete it to fetch again.`);
      }
    }
    const fresh = await fetchIt();
    fs.mkdirSync(this.#dir, { recursive: true });
    const tmp = `${full}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(fresh), "utf8");
    fs.renameSync(tmp, full);
    return fresh;
  }

  async #call(method: "GET" | "POST", pathname: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await this.#http.fetch(`${this.#baseUrl}${pathname}`, {
        method,
        headers: {
          "exp-api-key": this.#apiKey,
          Accept: "application/json;version=2.0",
          "Accept-Language": this.#language,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new ViatorCatalogError(
        this.#redact(`${pathname} did not get a response (${error instanceof Error ? error.message : String(error)}).`),
      );
    }
    if (!res.ok) {
      let snippet = "";
      try {
        snippet = (await res.text()).replace(/\s+/g, " ").trim().slice(0, BODY_SNIPPET_CHARS);
      } catch {
        // No readable body: the status alone will have to do.
      }
      throw new ViatorCatalogError(
        this.#redact(`${pathname} failed with HTTP ${res.status}${snippet === "" ? "" : ` (reply: ${snippet})`}.`),
      );
    }
    try {
      return await res.json();
    } catch {
      throw new ViatorCatalogError(`${pathname} returned a body that is not JSON.`);
    }
  }

  #redact(message: string): string {
    return message.split(this.#apiKey).join("[redacted]");
  }
}
