import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, jest } from "@jest/globals";

import { AllowlistFetch, type FetchLike } from "./http/allowlist-fetch";
import type { Sleep } from "./http/fetch-with-backoff";
import { normalizeViatorProduct, type TourDTO } from "./normalizer";
import {
  PriceResolver,
  toResolvedPrice,
  type PriceResolverConfig,
} from "./price-resolver";

const FIXTURES = join(__dirname, "__fixtures__");

function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, file), "utf8")) as T;
}

const CONFIG: PriceResolverConfig = {
  baseUrl: "https://api.viator.com/partner",
  apiKey: "test-key",
  language: "en-US",
  // Force serial fetching so call-order/dedup assertions are deterministic.
  concurrency: 1,
};

/** A minimal Tour DTO for a given product code; only the fields the resolver reads. */
function tourWithCode(code: string): TourDTO {
  return normalizeViatorProduct(
    { productCode: code, title: `Tour ${code}` },
    { fetchedAt: "2026-07-18T00:00:00.000Z" },
  );
}

/**
 * A fetch stub for `/availability/schedules/{code}`. Serves a body per product
 * code (from `bodies`), 404s for any code not present, and records the requested
 * URLs so tests can assert call count and de-duplication.
 */
function schedulesFetch(bodies: Record<string, unknown>): {
  fetchImpl: jest.Mock<FetchLike>;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchImpl = jest.fn<FetchLike>((input) => {
    const url = String(input);
    urls.push(url);
    const code = decodeURIComponent(url.split("/availability/schedules/")[1] ?? "");
    const body = bodies[code];
    if (body === undefined) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200 }),
    );
  });
  return { fetchImpl, urls };
}

function makeResolver(fetchImpl: FetchLike): PriceResolver {
  const http = new AllowlistFetch(["api.viator.com"], fetchImpl);
  return new PriceResolver(CONFIG, http, {}, () => Promise.resolve());
}

describe("PriceResolver — real captured schedules payload (BRI-165)", () => {
  // The verbatim live response of `GET /availability/schedules/57189P2` (Viator
  // Partner API production, captured 2026-07-25): the endpoint that actually
  // carries the "from" price the product payload does not.
  const schedules = loadJson<Record<string, unknown>>(
    "viator-schedules-57189P2.json",
  );

  it("resolves the real fromPrice (major units) to minor units + currency", async () => {
    const { fetchImpl } = schedulesFetch({ "57189P2": schedules });
    const resolver = makeResolver(fetchImpl);

    const resolved = await resolver.resolve(["57189P2"]);

    // summary.fromPrice = 28.00 (USD) → 2800 minor units.
    expect(resolved.get("57189P2")).toEqual({
      productCode: "57189P2",
      priceMinor: 2800,
      currency: "USD",
    });
  });

  it("attaches the real price onto a normalized (null-priced) tour", async () => {
    const { fetchImpl } = schedulesFetch({ "57189P2": schedules });
    const resolver = makeResolver(fetchImpl);

    const [tour] = await resolver.attachPrices([tourWithCode("57189P2")]);

    // The normalizer leaves these null; the resolver fills them from schedules.
    expect(tour.price_minor).toBe(2800);
    expect(tour.currency).toBe("USD");
    // This is a real, positive price — it passes the ST-8 validator's price gate.
    expect(tour.price_minor).toBeGreaterThan(0);
  });

  it("calls the schedules endpoint with the product code in the path", async () => {
    const { fetchImpl, urls } = schedulesFetch({ "57189P2": schedules });
    await makeResolver(fetchImpl).resolve(["57189P2"]);

    expect(urls).toEqual([
      "https://api.viator.com/partner/availability/schedules/57189P2",
    ]);
  });
});

describe("PriceResolver — tolerance & correctness", () => {
  it("leaves a product unpriced (absent) when its schedules call 404s", async () => {
    const { fetchImpl } = schedulesFetch({}); // every code 404s
    const resolved = await makeResolver(fetchImpl).resolve(["MISSING1"]);
    expect(resolved.has("MISSING1")).toBe(false);
  });

  it("does not sink the batch: one 404 among several still resolves the rest", async () => {
    const { fetchImpl } = schedulesFetch({
      GOOD1: { currency: "USD", summary: { fromPrice: 50 } },
      GOOD2: { currency: "EUR", summary: { fromPrice: 12.5 } },
    });
    const resolved = await makeResolver(fetchImpl).resolve([
      "GOOD1",
      "MISSING",
      "GOOD2",
    ]);

    expect(resolved.get("GOOD1")?.priceMinor).toBe(5000);
    expect(resolved.get("GOOD2")).toEqual({
      productCode: "GOOD2",
      priceMinor: 1250,
      currency: "EUR",
    });
    expect(resolved.has("MISSING")).toBe(false);
  });

  it("leaves a tour's price null when unresolved (so the validator quarantines it)", async () => {
    const { fetchImpl } = schedulesFetch({});
    const [tour] = await makeResolver(fetchImpl).attachPrices([
      tourWithCode("MISSING1"),
    ]);
    expect(tour.price_minor).toBeNull();
    expect(tour.currency).toBeNull();
  });

  it("de-duplicates repeated product codes within one run (fetches each once)", async () => {
    const { fetchImpl, urls } = schedulesFetch({
      DUP: { currency: "USD", summary: { fromPrice: 10 } },
    });
    await makeResolver(fetchImpl).resolve(["DUP", "DUP", "DUP"]);
    expect(urls).toHaveLength(1);
  });

  it("does not mutate input tours", async () => {
    const { fetchImpl } = schedulesFetch({
      C1: { currency: "USD", summary: { fromPrice: 10 } },
    });
    const input = tourWithCode("C1");
    const snapshot = JSON.stringify(input);
    await makeResolver(fetchImpl).attachPrices([input]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("toResolvedPrice — pure mapping", () => {
  it("converts a major-unit fromPrice to minor units", () => {
    expect(
      toResolvedPrice("X", { currency: "USD", summary: { fromPrice: 28 } }),
    ).toEqual({ productCode: "X", priceMinor: 2800, currency: "USD" });
  });

  it("rounds fractional major-unit prices to the nearest minor unit", () => {
    expect(
      toResolvedPrice("X", { currency: "USD", summary: { fromPrice: 78.85 } })
        ?.priceMinor,
    ).toBe(7885);
  });

  it("returns null when the price amount is absent", () => {
    expect(toResolvedPrice("X", { currency: "USD", summary: {} })).toBeNull();
    expect(toResolvedPrice("X", { currency: "USD" })).toBeNull();
  });

  it("returns null when the currency is absent", () => {
    expect(toResolvedPrice("X", { summary: { fromPrice: 28 } })).toBeNull();
  });

  it("preserves a zero price (0 minor units) for the validator to reject, not the resolver", () => {
    // A free/zero product resolves to 0 — the ST-8 validator owns the
    // non-positive-price decision; the resolver just reports what Viator returned.
    expect(
      toResolvedPrice("X", { currency: "USD", summary: { fromPrice: 0 } }),
    ).toEqual({ productCode: "X", priceMinor: 0, currency: "USD" });
  });
});

const timeoutError = () =>
  new DOMException("The operation was aborted due to timeout", "TimeoutError");

describe("PriceResolver — /availability/schedules retry (BRI-183)", () => {
  const SCHEDULES = { currency: "USD", summary: { fromPrice: 12.5 } };
  const ok = () => Promise.resolve(new Response(JSON.stringify(SCHEDULES), { status: 200 }));

  function retrying(fetchImpl: jest.Mock<FetchLike>, maxRetries = 5) {
    const sleep = jest.fn<Sleep>().mockResolvedValue(undefined);
    const resolver = new PriceResolver(
      CONFIG,
      new AllowlistFetch(["api.viator.com"], fetchImpl),
      { baseDelayMs: 100, maxDelayMs: 10_000, maxRetries },
      sleep,
      () => 0.5,
    );
    return { resolver, sleep };
  }

  it("retries a timeout, then prices the product", async () => {
    const fetchImpl = jest
      .fn<FetchLike>()
      .mockRejectedValueOnce(timeoutError())
      .mockImplementation(ok);
    const { resolver, sleep } = retrying(fetchImpl);

    const resolved = await resolver.resolve(["57189P2"]);

    expect(resolved.get("57189P2")?.priceMinor).toBe(1250);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(50);
  });

  it("retries a 503, then prices the product", async () => {
    const fetchImpl = jest
      .fn<FetchLike>()
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockImplementation(ok);
    const { resolver } = retrying(fetchImpl);

    expect((await resolver.resolve(["57189P2"])).has("57189P2")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404 — leaves the product unpriced", async () => {
    const fetchImpl = jest.fn<FetchLike>(() =>
      Promise.resolve(new Response("nope", { status: 404 })),
    );
    const { resolver, sleep } = retrying(fetchImpl);

    expect((await resolver.resolve(["57189P2"])).size).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("after maxRetries attempts falls back to unpriced (the existing tolerance)", async () => {
    const fetchImpl = jest.fn<FetchLike>(() => Promise.reject(timeoutError()));
    const { resolver, sleep } = retrying(fetchImpl, 3);

    const resolved = await resolver.resolve(["57189P2"]);

    expect(resolved.size).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
