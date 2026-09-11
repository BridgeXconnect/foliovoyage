import { Logger } from "@nestjs/common";
import { z } from "zod";

import type { PrismaService } from "../../prisma/prisma.service";
import type { AllowlistFetch } from "./http/allowlist-fetch";

/**
 * FX rate resolver + cache (category/currency promotion plan, Task 2).
 *
 * `/availability/schedules` (`price-resolver.ts`) returns a "from" price in the
 * *supplier's* currency, which varies per product. Price bands/comparisons need
 * one common currency (`PRICE_REFERENCE_CURRENCY`, USD by default), so this
 * resolver converts via Viator's `/exchange-rates` endpoint, caching each
 * resolved rate in `ProviderExchangeRate` until Viator's own `expiry` passes.
 *
 * **Live-verified request/response shape (2026-09-11, production, one real
 * call with the Doppler-injected key):** this plan's own draft assumed a GET
 * with repeated `sourceCurrencies`/`targetCurrencies` query params. The real
 * endpoint rejects GET outright (`405 METHOD_NOT_ALLOWED`) — it is a **POST**
 * with a JSON body `{ sourceCurrencies: string[], targetCurrencies: string[] }`.
 * The response envelope matched the plan's assumption exactly: `{ rates: [{
 * sourceCurrency, targetCurrency, rate, lastUpdated, expiry }] }`. A source
 * currency the endpoint can't resolve is simply omitted from `rates` (still a
 * 200), confirmed live with a bogus currency code — never a per-item error.
 *
 * Same tolerance shape as `price-resolver.ts`: a network error, non-OK
 * response, or unexpected payload shape is caught, logged via `Logger.warn`,
 * and leaves the affected currencies unresolved rather than throwing — one bad
 * batch never sinks the whole run.
 */

/** Config the resolver needs to reach Viator (mirrors `price-resolver.ts`). */
export interface ExchangeRateConfig {
  /** Viator API base URL, e.g. `https://api.viator.com/partner`. */
  baseUrl: string;
  /** Viator Partner API key (sent as `exp-api-key`). */
  apiKey: string;
  /** Accept-Language header value, e.g. `en-US`. */
  language: string;
  /** Reference currency every rate converts to (`PRICE_REFERENCE_CURRENCY`). */
  targetCurrency: string;
}

/** A resolved + cacheable FX rate for one currency pair. */
export interface CachedExchangeRate {
  /** ISO-4217 source currency (the supplier's), e.g. "THB". */
  sourceCurrency: string;
  /** ISO-4217 target currency — always {@link ExchangeRateConfig.targetCurrency}. */
  targetCurrency: string;
  /** Multiply a source-currency major amount by this to get a target-currency major amount. */
  rate: number;
  /** Viator's `lastUpdated` for this rate. */
  lastUpdatedAt: Date;
  /** Viator's `expiry`: the rate is valid until this instant. */
  expiresAt: Date;
}

/**
 * Persistence seam for cached rates, keyed by source currency (the resolver is
 * always scoped to one target currency). Backed in production by
 * {@link PrismaExchangeRateCache}; unit tests use an in-memory fake.
 */
export interface ExchangeRateCache {
  get(sourceCurrency: string): Promise<CachedExchangeRate | null>;
  upsert(row: CachedExchangeRate): Promise<void>;
}

/**
 * Prisma-backed {@link ExchangeRateCache}, persisting to `ProviderExchangeRate`.
 * Scoped to one provider + target currency for its whole lifetime (mirrors
 * {@link ExchangeRateResolver}'s own single-target-currency scope).
 */
export class PrismaExchangeRateCache implements ExchangeRateCache {
  constructor(
    private readonly prisma: PrismaService,
    private readonly targetCurrency: string,
    private readonly provider: string = "viator",
  ) {}

  async get(sourceCurrency: string): Promise<CachedExchangeRate | null> {
    const row = await this.prisma.providerExchangeRate.findUnique({
      where: {
        provider_sourceCurrency_targetCurrency: {
          provider: this.provider,
          sourceCurrency,
          targetCurrency: this.targetCurrency,
        },
      },
    });
    if (!row) return null;

    return {
      sourceCurrency: row.sourceCurrency,
      targetCurrency: row.targetCurrency,
      rate: row.rate,
      lastUpdatedAt: row.lastUpdatedAt,
      expiresAt: row.expiresAt,
    };
  }

  async upsert(row: CachedExchangeRate): Promise<void> {
    await this.prisma.providerExchangeRate.upsert({
      where: {
        provider_sourceCurrency_targetCurrency: {
          provider: this.provider,
          sourceCurrency: row.sourceCurrency,
          targetCurrency: row.targetCurrency,
        },
      },
      create: {
        provider: this.provider,
        sourceCurrency: row.sourceCurrency,
        targetCurrency: row.targetCurrency,
        rate: row.rate,
        lastUpdatedAt: row.lastUpdatedAt,
        expiresAt: row.expiresAt,
      },
      update: {
        rate: row.rate,
        lastUpdatedAt: row.lastUpdatedAt,
        expiresAt: row.expiresAt,
      },
    });
  }
}

/**
 * Schema for the live `/exchange-rates` response (verified 2026-09-11): a
 * `rates` array of `{ sourceCurrency, targetCurrency, rate, lastUpdated,
 * expiry }`. Only the fields we use are validated; unknown fields pass through.
 */
const exchangeRatesResponseSchema = z
  .object({
    rates: z.array(
      z
        .object({
          sourceCurrency: z.string(),
          targetCurrency: z.string(),
          rate: z.number(),
          lastUpdated: z.string(),
          expiry: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export class ExchangeRateResolver {
  private readonly logger = new Logger(ExchangeRateResolver.name);

  constructor(
    private readonly config: ExchangeRateConfig,
    private readonly http: AllowlistFetch,
    private readonly cache: ExchangeRateCache,
  ) {}

  /**
   * Resolve `sourceCurrency → rate` for a set of provider-quoted currencies,
   * where multiplying a source-currency major amount by the rate yields a
   * {@link ExchangeRateConfig.targetCurrency} major amount. The reference
   * currency itself always maps to `1` without a cache lookup or fetch. A
   * fresh cache hit (`expiresAt` in the future) is used as-is; an expired or
   * missing rate is batch-fetched from Viator and cached. A currency Viator
   * can't resolve, or that fails to fetch, is simply absent from the result —
   * this never throws.
   */
  async ratesToUsd(sourceCurrencies: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const unique = [
      ...new Set(
        sourceCurrencies.map((c) => c.toUpperCase()).filter((c) => c.length > 0),
      ),
    ];

    const toFetch: string[] = [];
    for (const currency of unique) {
      if (currency === this.config.targetCurrency) {
        result.set(currency, 1);
        continue;
      }

      const cached = await this.cache.get(currency);
      if (cached && cached.expiresAt.getTime() > Date.now()) {
        result.set(currency, cached.rate);
        continue;
      }

      toFetch.push(currency);
    }

    if (toFetch.length === 0) return result;

    const fetched = await this.fetchRates(toFetch);
    for (const row of fetched) {
      result.set(row.sourceCurrency, row.rate);
      await this.cache.upsert(row);
    }

    return result;
  }

  /**
   * POST one batch request to `/exchange-rates` and extract the rows. Returns
   * `[]` (never throws) on a network error, non-OK response, or unexpected
   * payload shape, logging a warning — the affected currencies stay
   * unresolved in {@link ratesToUsd} rather than aborting the caller's batch.
   */
  private async fetchRates(
    sourceCurrencies: string[],
  ): Promise<CachedExchangeRate[]> {
    let response: Awaited<ReturnType<AllowlistFetch["fetch"]>>;
    try {
      response = await this.http.fetch(this.buildUrl(), {
        method: "POST",
        headers: {
          "exp-api-key": this.config.apiKey,
          Accept: "application/json;version=2.0",
          "Content-Type": "application/json",
          "Accept-Language": this.config.language,
        },
        body: JSON.stringify({
          sourceCurrencies,
          targetCurrencies: [this.config.targetCurrency],
        }),
      });
    } catch (error) {
      this.logger.warn(
        `Viator /exchange-rates request errored: ` +
          `${error instanceof Error ? error.message : String(error)}; ` +
          `${sourceCurrencies.join(", ")} left unresolved`,
      );
      return [];
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.warn(
        `Viator /exchange-rates failed: ` +
          `${response.status} ${response.statusText} ${body}`.trim() +
          `; ${sourceCurrencies.join(", ")} left unresolved`,
      );
      return [];
    }

    const parsed = exchangeRatesResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      this.logger.warn(
        `Viator /exchange-rates returned an unexpected shape; ` +
          `${sourceCurrencies.join(", ")} left unresolved`,
      );
      return [];
    }

    return parsed.data.rates
      .filter((rate) => rate.targetCurrency === this.config.targetCurrency)
      .map((rate) => ({
        sourceCurrency: rate.sourceCurrency,
        targetCurrency: rate.targetCurrency,
        rate: rate.rate,
        lastUpdatedAt: new Date(rate.lastUpdated),
        expiresAt: new Date(rate.expiry),
      }));
  }

  /** Build the `/exchange-rates` URL from the configured base. */
  private buildUrl(): URL {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    return new URL(`${base}/exchange-rates`);
  }
}
