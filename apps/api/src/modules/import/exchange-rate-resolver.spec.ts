import { describe, expect, it, jest } from "@jest/globals";

import { AllowlistFetch, type FetchLike } from "./http/allowlist-fetch";
import type { Sleep } from "./http/fetch-with-backoff";
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
  return new ExchangeRateResolver(CONFIG, http, cache, {}, () => Promise.resolve());
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

const timeoutError = () =>
  new DOMException("The operation was aborted due to timeout", "TimeoutError");

describe("ExchangeRateResolver — /exchange-rates retry (BRI-183)", () => {
  const RATES = {
    rates: [
      {
        sourceCurrency: "EUR",
        targetCurrency: "USD",
        rate: 1.1,
        lastUpdated: "2026-09-01T00:00:00Z",
        expiry: "2099-01-01T00:00:00Z",
      },
    ],
  };
  const ok = () => Promise.resolve(okJson(RATES));

  function retrying(fetchImpl: jest.Mock<FetchLike>, cache: ExchangeRateCache, maxRetries = 5) {
    const sleep = jest.fn<Sleep>().mockResolvedValue(undefined);
    const resolver = new ExchangeRateResolver(
      CONFIG,
      new AllowlistFetch(["api.viator.com"], fetchImpl),
      cache,
      { baseDelayMs: 100, maxDelayMs: 10_000, maxRetries },
      sleep,
      () => 0.5,
    );
    return { resolver, sleep };
  }

  it("retries a timeout, then resolves and caches the rate", async () => {
    const fetchImpl = jest
      .fn<FetchLike>()
      .mockRejectedValueOnce(timeoutError())
      .mockImplementation(ok);
    const cache = memCache();
    const { resolver, sleep } = retrying(fetchImpl, cache);

    const rates = await resolver.ratesToUsd(["EUR"]);

    expect(rates.get("EUR")).toBe(1.1);
    expect(cache.rows.has("EUR")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(50);
  });

  it("does not retry a 400", async () => {
    const fetchImpl = jest.fn<FetchLike>(() =>
      Promise.resolve(new Response("bad", { status: 400 })),
    );
    const { resolver, sleep } = retrying(fetchImpl, memCache());

    expect((await resolver.ratesToUsd(["EUR"])).has("EUR")).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("after maxRetries attempts leaves the currency unresolved and caches nothing", async () => {
    const fetchImpl = jest.fn<FetchLike>(() =>
      Promise.resolve(new Response("down", { status: 500 })),
    );
    const cache = memCache();
    const { resolver, sleep } = retrying(fetchImpl, cache, 3);

    expect((await resolver.ratesToUsd(["EUR"])).has("EUR")).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(cache.rows.size).toBe(0);
  });
});
