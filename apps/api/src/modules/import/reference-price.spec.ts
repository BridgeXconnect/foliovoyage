import { describe, expect, it, jest } from "@jest/globals";

import type { ExchangeRateResolver } from "./exchange-rate-resolver";
import type { TourDTO } from "./normalizer";
import { computeReferenceMinor, ReferencePriceResolver } from "./reference-price";

describe("computeReferenceMinor", () => {
  it("converts a supplier minor amount to USD minor via the rate", () => {
    // 500000 minor THB = 5000.00 THB major; ×0.028 = 140.00 USD → 14000 USD minor
    expect(computeReferenceMinor(500000, 0.028)).toBe(14000);
  });

  it("is identity at rate 1 (USD source)", () => {
    expect(computeReferenceMinor(2800, 1)).toBe(2800);
  });

  it("returns null when price or rate is missing", () => {
    expect(computeReferenceMinor(null, 0.028)).toBeNull();
    expect(computeReferenceMinor(2800, undefined)).toBeNull();
  });
});

/** A minimal, otherwise-valid TourDTO — tests override only what they check. */
function dto(overrides: Partial<TourDTO> = {}): TourDTO {
  return {
    provider: "viator",
    provider_tour_id: "P1",
    title: "A tour",
    description: "A description.",
    duration_min: null,
    rating_avg: null,
    rating_count: null,
    price_minor: null,
    currency: null,
    price_reference_minor: null,
    price_reference_currency: null,
    affiliate_url: null,
    location_ref: null,
    latitude: null,
    longitude: null,
    image_url: null,
    image_alt: null,
    destination_refs: [],
    tags: [],
    primary_category_tag_id: null,
    images: [],
    inclusions: [],
    exclusions: [],
    cancellation_policy: null,
    reviews_by_source: [],
    fetched_at: "2026-07-18T00:00:00.000Z",
    source_hash: "abc",
    ...overrides,
  };
}

describe("ReferencePriceResolver.attachReferencePrices", () => {
  it("attaches USD reference prices for a mixed-currency batch", async () => {
    const resolver = {
      ratesToUsd: jest.fn(
        (): Promise<Map<string, number>> =>
          Promise.resolve(
            new Map([
              ["THB", 0.028],
              ["USD", 1],
            ]),
          ),
      ),
    };
    const step = new ReferencePriceResolver(
      resolver as unknown as ExchangeRateResolver,
      "USD",
    );

    const out = await step.attachReferencePrices([
      dto({ provider_tour_id: "A", currency: "THB", price_minor: 500000 }),
      dto({ provider_tour_id: "B", currency: "USD", price_minor: 2800 }),
      dto({ provider_tour_id: "C", currency: "EUR", price_minor: 5000 }), // no rate → null reference
      dto({ provider_tour_id: "D", currency: null, price_minor: null }), // unpriced → null reference
    ]);

    expect(out[0].price_reference_minor).toBe(14000);
    expect(out[0].price_reference_currency).toBe("USD");
    expect(out[1].price_reference_minor).toBe(2800);
    expect(out[2].price_reference_minor).toBeNull();
    expect(out[2].price_reference_currency).toBeNull();
    expect(out[3].price_reference_minor).toBeNull();
    expect(resolver.ratesToUsd).toHaveBeenCalledTimes(1); // one batched resolve

    // Input DTOs are not mutated — returned array holds new objects.
    const original = dto({ provider_tour_id: "A", currency: "THB", price_minor: 500000 });
    expect(original.price_reference_minor).toBeNull();
  });
});
