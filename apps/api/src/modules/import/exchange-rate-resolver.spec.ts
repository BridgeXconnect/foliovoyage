import { describe, expect, it, jest } from "@jest/globals";

import { AllowlistFetch, type FetchLike } from "./http/allowlist-fetch";
import {
  ExchangeRateResolver,
  type CachedExchangeRate,
  type ExchangeRateCache,
  type ExchangeRateConfig,
} from "./exchange-rate-resolver";

const CONFIG: ExchangeRateConfig = {
  baseUrl: "https://api.viator.com/partner",
  apiKey: "test-key",
  language: "en-US",
  targetCurrency: "USD",
};

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

/** In-memory {@link ExchangeRateCache}, keyed by source currency. */
function memCache(
  seed: CachedExchangeRate[] = [],
): ExchangeRateCache & { rows: Map<string, CachedExchangeRate> } {
  const rows = new Map(seed.map((r) => [r.sourceCurrency, r]));
  return {
    rows,
    get: (sourceCurrency) => Promise.resolve(rows.get(sourceCurrency) ?? null),
    upsert: (row) => {
      rows.set(row.sourceCurrency, row);
      return Promise.resolve();
    },
  };
}

function makeResolver(
  fetchImpl: FetchLike,
  cache: ExchangeRateCache,
): ExchangeRateResolver {
  const http = new AllowlistFetch(["api.viator.com"], fetchImpl);
  return new ExchangeRateResolver(CONFIG, http, cache);
}

describe("ExchangeRateResolver — reference currency short-circuit", () => {
  it("returns 1 for USD and never fetches", async () => {
    const fetchImpl = jest.fn<FetchLike>();
    const resolver = makeResolver(fetchImpl, memCache());

    const rates = await resolver.ratesToUsd(["USD"]);

    expect(rates.get("USD")).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ExchangeRateResolver — cache hit/miss/expiry", () => {
  it("uses a fresh cached rate without fetching", async () => {
    const fetchImpl = jest.fn<FetchLike>();
    const cache = memCache([
      {
        sourceCurrency: "EUR",
        targetCurrency: "USD",
        rate: 1.18,
        lastUpdatedAt: new Date("2026-09-11T00:00:00Z"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);
    const resolver = makeResolver(fetchImpl, cache);

    const rates = await resolver.ratesToUsd(["EUR"]);

    expect(rates.get("EUR")).toBe(1.18);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches and caches a missing rate", async () => {
    const fetchImpl = jest.fn<FetchLike>(() =>
      Promise.resolve(
        okJson({
          rates: [
            {
              sourceCurrency: "THB",
              targetCurrency: "USD",
              rate: 0.028,
              lastUpdated: "2026-09-11T00:00:00Z",
              expiry: "2026-09-12T00:00:00Z",
            },
          ],
        }),
      ),
    );
    const cache = memCache();
    const resolver = makeResolver(fetchImpl, cache);

    const rates = await resolver.ratesToUsd(["THB"]);

    expect(rates.get("THB")).toBeCloseTo(0.028);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await cache.get("THB")).toBeTruthy();
  });

  it("re-fetches an expired cached rate instead of serving the stale value", async () => {
    const fetchImpl = jest.fn<FetchLike>(() =>
      Promise.resolve(
        okJson({
          rates: [
            {
              sourceCurrency: "EUR",
              targetCurrency: "USD",
              rate: 1.2,
              lastUpdated: "2026-09-11T00:00:00Z",
              expiry: "2026-09-12T00:00:00Z",
            },
          ],
        }),
      ),
    );
    const cache = memCache([
      {
        sourceCurrency: "EUR",
        targetCurrency: "USD",
        rate: 1.0,
        lastUpdatedAt: new Date("2026-09-01T00:00:00Z"),
        expiresAt: new Date(Date.now() - 60_000),
      },
    ]);
    const resolver = makeResolver(fetchImpl, cache);

    const rates = await resolver.ratesToUsd(["EUR"]);

    expect(rates.get("EUR")).toBe(1.2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("ExchangeRateResolver — tolerance", () => {
  it("omits a currency the endpoint doesn't return", async () => {
    const fetchImpl = jest.fn<FetchLike>(() =>
      Promise.resolve(okJson({ rates: [] })),
    );
    const resolver = makeResolver(fetchImpl, memCache());

    const rates = await resolver.ratesToUsd(["ZZZ"]);

    expect(rates.has("ZZZ")).toBe(false);
  });

  it("never throws on a network failure — leaves the currency unresolved", async () => {
    const fetchImpl = jest.fn<FetchLike>(() =>
      Promise.reject(new Error("network down")),
    );
    const resolver = makeResolver(fetchImpl, memCache());

    const rates = await resolver.ratesToUsd(["EUR"]);

    expect(rates.has("EUR")).toBe(false);
  });

  it("never throws on a non-OK response", async () => {
    const fetchImpl = jest.fn<FetchLike>(() =>
      Promise.resolve(new Response("server error", { status: 500 })),
    );
    const resolver = makeResolver(fetchImpl, memCache());

    const rates = await resolver.ratesToUsd(["EUR"]);

    expect(rates.has("EUR")).toBe(false);
  });

  it("never throws on an unexpected response shape", async () => {
    const fetchImpl = jest.fn<FetchLike>(() =>
      Promise.resolve(okJson({ notRates: [] })),
    );
    const resolver = makeResolver(fetchImpl, memCache());

    const rates = await resolver.ratesToUsd(["EUR"]);

    expect(rates.has("EUR")).toBe(false);
  });
});

describe("ExchangeRateResolver — request shape (live-verified 2026-09-11)", () => {
  it("sends a POST with a JSON body — not a GET with query-array params", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = jest.fn<FetchLike>((_url, init) => {
      capturedInit = init;
      return Promise.resolve(okJson({ rates: [] }));
    });
    const resolver = makeResolver(fetchImpl, memCache());

    await resolver.ratesToUsd(["EUR", "THB"]);

    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      sourceCurrencies: ["EUR", "THB"],
      targetCurrencies: ["USD"],
    });
  });
});
