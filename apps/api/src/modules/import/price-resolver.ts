import { Logger } from "@nestjs/common";
import { z } from "zod";

import type { AllowlistFetch } from "./http/allowlist-fetch";
import {
  type BackoffOptions,
  defaultSleep,
  fetchWithBackoff,
  type Sleep,
  withBackoffDefaults,
} from "./http/fetch-with-backoff";
import type { TourDTO } from "./normalizer";

/**
 * Price resolver (ST-7c / BRI-165).
 *
 * Viator's product payload does **not** carry a price. Verified against the live
 * production API (2026-07-25): both `GET /products/modified-since` (the ingest
 * crawl) and single-product `GET /products/{code}` return `pricingInfo` — but
 * that object holds only booking constraints (`type` + `ageBands`), never an
 * amount. A deep field-scan of a full product detail turned up no price/amount
 * anywhere. (The `pricing.summary.fromPrice` shape the normalizer once assumed is
 * real, but it belongs to a *different* endpoint — the Basic-tier
 * `POST /products/search` **summary** — not the Full-Access product **detail**
 * the pipeline ingests. That mismatch is the BRI-165 bug.)
 *
 * The "from" price lives in a **separate per-product endpoint**,
 * `GET /availability/schedules/{productCode}`, as `summary.fromPrice` (a
 * major-unit amount) plus a top-level `currency` (ISO-4217). So price is resolved
 * after normalization, exactly like coordinates (BRI-163): the normalizer leaves
 * {@link TourDTO.price_minor}/{@link TourDTO.currency} `null`, and this resolver
 * attaches them before the ST-8 validator — which quarantines priceless tours, so
 * without this step every real import is quarantined.
 *
 * Two properties keep it safe:
 *
 * - **SSRF-safe** — every request goes through the same {@link AllowlistFetch}
 *   the ST-6 client and location resolver use, locked to the Viator API host.
 * - **Tolerant per product** — a product whose schedules call fails or carries no
 *   price is simply left unpriced (and will quarantine downstream); one bad
 *   product never sinks the run. The call is retried first (BRI-183, via
 *   `fetchWithBackoff`: request + body read, transient errors and 429/5xx); only
 *   once retries are exhausted, or on a non-retryable status, does the product
 *   fall back to unpriced.
 *
 * Unlike the location resolver there is **no persistent cache**: a "from" price is
 * volatile (it can move between runs), so caching it indefinitely would serve
 * stale prices. Within a single run identical product codes are de-duplicated so
 * each code is fetched at most once. (Per-product fanout across a full-catalogue
 * crawl is a real scaling concern — bounded here to curated-city runs and
 * revisited with the M6 queue/worker, ST-33.)
 */

/**
 * Default number of concurrent schedules requests. Modest on purpose: the
 * schedules endpoint is per-product, so a run makes many small calls — a small
 * pool keeps throughput up without tripping Viator's rate limiter.
 */
export const DEFAULT_PRICE_RESOLVER_CONCURRENCY = 5;

/** A resolved price: the product code plus its "from" price and currency. */
export interface ResolvedPrice {
  /** The Viator product code this resolves, e.g. `"57189P2"`. */
  productCode: string;
  /** "From" price in **minor** units (e.g. cents): `summary.fromPrice` × 100. */
  priceMinor: number;
  /** ISO-4217 currency code from the top-level `currency` field. */
  currency: string;
}

/** Config the resolver needs to reach Viator (mirrors the ST-6 client). */
export interface PriceResolverConfig {
  /** Viator API base URL, e.g. `https://api.viator.com/partner`. */
  baseUrl: string;
  /** Viator Partner API key (sent as `exp-api-key`). */
  apiKey: string;
  /** Accept-Language header value, e.g. `en-US`. */
  language: string;
  /**
   * Max concurrent schedules requests. Defaults to
   * {@link DEFAULT_PRICE_RESOLVER_CONCURRENCY}.
   */
  concurrency?: number;
}

/**
 * Schema for the `/availability/schedules/{code}` response, matched to the
 * **live** payload (verified against product 57189P2, 2026-07-25):
 * `{ productCode, bookableItems, currency, summary: { fromPrice } }`. We validate
 * only the two fields we need — `currency` and `summary.fromPrice` — and tolerate
 * everything else (`bookableItems`, per-item schedules, …). Both are optional so
 * a product with no priced availability is dropped by {@link toResolvedPrice}
 * rather than failing the parse.
 */
const schedulesResponseSchema = z
  .object({
    currency: z.string().optional(),
    summary: z
      .object({
        fromPrice: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export class PriceResolver {
  private readonly logger = new Logger(PriceResolver.name);
  private readonly concurrency: number;
  private readonly backoff: Required<BackoffOptions>;

  constructor(
    private readonly config: PriceResolverConfig,
    private readonly http: AllowlistFetch,
    backoff: BackoffOptions = {},
    private readonly sleep: Sleep = defaultSleep,
    private readonly random: () => number = Math.random,
  ) {
    this.backoff = withBackoffDefaults(backoff);
    this.concurrency = Math.max(1, config.concurrency ?? DEFAULT_PRICE_RESOLVER_CONCURRENCY);
  }

  /**
   * Resolve a set of product codes to prices. Input order and duplicates don't
   * matter — codes are de-duplicated and the result is a map keyed by product
   * code, holding every code that resolved to a price. A code whose schedules
   * call fails, or that carries no `summary.fromPrice`, is simply absent from the
   * map (left unpriced downstream).
   */
  async resolve(productCodes: string[]): Promise<Map<string, ResolvedPrice>> {
    const unique = [...new Set(productCodes.filter((c) => c.length > 0))];
    const resolved = new Map<string, ResolvedPrice>();
    if (unique.length === 0) return resolved;

    let unpriced = 0;
    await mapWithConcurrency(unique, this.concurrency, async (code) => {
      const price = await this.fetchPrice(code);
      if (price) resolved.set(price.productCode, price);
      else unpriced += 1;
    });

    this.logger.debug(
      `Resolved ${resolved.size}/${unique.length} product price(s)` +
        (unpriced > 0 ? ` (${unpriced} left unpriced)` : ""),
    );
    return resolved;
  }

  /**
   * Attach resolved "from" prices to a batch of tours. Reads each tour's
   * {@link TourDTO.provider_tour_id}, resolves the whole set in one pass, and
   * returns new DTOs with `price_minor`/`currency` filled in. Tours whose code
   * does not resolve to a price come back with both left `null` (and are
   * quarantined by the validator). Input DTOs are not mutated.
   */
  async attachPrices(tours: TourDTO[]): Promise<TourDTO[]> {
    const codes = tours.map((t) => t.provider_tour_id);
    const resolved = await this.resolve(codes);

    return tours.map((tour) => {
      const price = resolved.get(tour.provider_tour_id);
      if (!price) return { ...tour };
      return { ...tour, price_minor: price.priceMinor, currency: price.currency };
    });
  }

  /**
   * GET one product's schedules and extract its "from" price. Returns `null` when
   * the call is non-OK or the payload carries no usable price — never throws for
   * a single product, so one failure can't abort the whole run.
   */
  private async fetchPrice(productCode: string): Promise<ResolvedPrice | null> {
    let body: string;
    try {
      body = await fetchWithBackoff(
        () =>
          this.http.fetch(this.buildUrl(productCode), {
            method: "GET",
            headers: {
              "exp-api-key": this.config.apiKey,
              Accept: "application/json;version=2.0",
              "Accept-Language": this.config.language,
            },
          }),
        (response) => response.text(),
        {
          name: `Viator /availability/schedules/${productCode}`,
          backoff: this.backoff,
          logger: this.logger,
          sleep: this.sleep,
          random: this.random,
        },
      );
    } catch (error) {
      // Retries exhausted, or a non-retryable status: leave this product
      // unpriced rather than failing the run (the fallback predates BRI-183).
      this.logger.warn(
        `${error instanceof Error ? error.message : String(error)}; left unpriced`,
      );
      return null;
    }

    const parsed = schedulesResponseSchema.safeParse(JSON.parse(body));
    if (!parsed.success) {
      this.logger.warn(
        `Viator /availability/schedules/${productCode} returned an ` +
          `unexpected shape; left unpriced`,
      );
      return null;
    }

    return toResolvedPrice(productCode, parsed.data);
  }

  /** Build the `/availability/schedules/{code}` URL from the configured base. */
  private buildUrl(productCode: string): URL {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    return new URL(`${base}/availability/schedules/${encodeURIComponent(productCode)}`);
  }
}

/**
 * Narrow a parsed schedules payload to a {@link ResolvedPrice}, or `null` when it
 * carries no usable price. `summary.fromPrice` is a **major-unit** amount, so it
 * is converted to integer minor units; a missing amount or currency yields
 * `null` (the product is left unpriced, not fabricated).
 */
export function toResolvedPrice(
  productCode: string,
  data: { currency?: string; summary?: { fromPrice?: number } },
): ResolvedPrice | null {
  const fromPrice = data.summary?.fromPrice;
  const currency = data.currency;
  if (
    typeof fromPrice !== "number" ||
    !Number.isFinite(fromPrice) ||
    typeof currency !== "string" ||
    currency.length === 0
  ) {
    return null;
  }
  return {
    productCode,
    priceMinor: Math.round(fromPrice * 100),
    currency,
  };
}

/**
 * Run `worker` over `items` with at most `limit` in flight at once. Order of
 * completion doesn't matter — the worker records into a shared structure — so
 * this is a simple index-cursor pool with no result aggregation.
 */
async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}
