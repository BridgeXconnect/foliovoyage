import { describe, expect, it } from "@jest/globals";

import type { TourDTO } from "./normalizer";
import {
  ImportRunStats,
  TourValidator,
  validateTour,
  type QuarantineRecord,
  type QuarantineReasonCode,
  type QuarantineStore,
} from "./validator";

/**
 * A fully valid, coordinate-bearing tour. Tests override single fields to
 * isolate one rule at a time, so the baseline must pass on its own.
 */
function makeTour(overrides: Partial<TourDTO> = {}): TourDTO {
  return {
    provider: "viator",
    provider_tour_id: "57189P2",
    title: "Small Group Hanoi Street Food Tour",
    description: "A walking street-food tour.",
    duration_min: 180,
    rating_avg: 5,
    rating_count: 5129,
    price_minor: 2800,
    currency: "USD",
    price_reference_minor: null,
    price_reference_currency: null,
    affiliate_url: "https://www.viator.com/tours/…",
    location_ref: "LOC-abc123",
    latitude: 21.036959,
    longitude: 105.8509,
    image_url: "https://media-cdn.tripadvisor.com/media/example.jpg",
    image_alt: "Hanoi street food",
    destination_refs: ["351"],
    tags: [],
    fetched_at: "2026-07-18T00:00:00.000Z",
    source_hash: "abc",
    ...overrides,
  };
}

/** Collect the reason codes from a result, or `[]` if it passed. */
function codes(tour: TourDTO): QuarantineReasonCode[] {
  const result = validateTour(tour);
  return result.ok ? [] : result.reasons.map((r) => r.code);
}

describe("validateTour — pass-through", () => {
  it("passes a fully valid row", () => {
    expect(validateTour(makeTour())).toEqual({ ok: true });
  });
});

describe("validateTour — title", () => {
  it("quarantines a missing (empty) title", () => {
    expect(codes(makeTour({ title: "" }))).toEqual(["MISSING_TITLE"]);
  });

  it("quarantines a whitespace-only title", () => {
    expect(codes(makeTour({ title: "   " }))).toEqual(["MISSING_TITLE"]);
  });
});

describe("validateTour — price (missing OR non-positive quarantines)", () => {
  it("quarantines a zero price", () => {
    expect(codes(makeTour({ price_minor: 0 }))).toEqual(["NON_POSITIVE_PRICE"]);
  });

  it("quarantines a negative price", () => {
    expect(codes(makeTour({ price_minor: -500 }))).toEqual([
      "NON_POSITIVE_PRICE",
    ]);
  });

  it("quarantines a null (missing) price with MISSING_PRICE", () => {
    // Unlike null geo, a missing price quarantines: a priceless tour can't
    // function on an affiliate-booking site. Distinct reason code from ≤0.
    expect(codes(makeTour({ price_minor: null }))).toEqual(["MISSING_PRICE"]);
  });

  it("passes a positive price", () => {
    expect(validateTour(makeTour({ price_minor: 1 })).ok).toBe(true);
  });
});

describe("validateTour — coordinates", () => {
  it("quarantines a latitude above 90", () => {
    expect(codes(makeTour({ latitude: 200, longitude: 10 }))).toEqual([
      "COORDINATES_OUT_OF_RANGE",
    ]);
  });

  it("quarantines a latitude below -90", () => {
    expect(codes(makeTour({ latitude: -91, longitude: 10 }))).toEqual([
      "COORDINATES_OUT_OF_RANGE",
    ]);
  });

  it("quarantines a longitude above 180", () => {
    expect(codes(makeTour({ latitude: 10, longitude: 181 }))).toEqual([
      "COORDINATES_OUT_OF_RANGE",
    ]);
  });

  it("quarantines a longitude below -180", () => {
    expect(codes(makeTour({ latitude: 10, longitude: -181 }))).toEqual([
      "COORDINATES_OUT_OF_RANGE",
    ]);
  });

  it("passes coordinates exactly on the boundary", () => {
    expect(validateTour(makeTour({ latitude: -90, longitude: 180 })).ok).toBe(
      true,
    );
    expect(validateTour(makeTour({ latitude: 90, longitude: -180 })).ok).toBe(
      true,
    );
  });

  it("quarantines an incomplete coordinate pair (one half null)", () => {
    // Defensive: the resolver always sets both or neither, but a half-resolved
    // pair is corruption, not the clean both-null gap.
    expect(codes(makeTour({ latitude: 21.03, longitude: null }))).toEqual([
      "COORDINATES_OUT_OF_RANGE",
    ]);
  });
});

describe("validateTour — null geo passes through (THE corrected BRI-163 rule)", () => {
  it("passes a row with BOTH latitude and longitude null", () => {
    // This is the behavior most likely to be silently reverted to the old
    // "geo required" rule. ~1 in 15 real tours resolve to a Google-provider
    // location with no coordinates — a structural gap, NOT malformed data.
    // Absent coordinates must NOT quarantine on their own.
    const result = validateTour(makeTour({ latitude: null, longitude: null }));

    expect(result).toEqual({ ok: true });
  });

  it("passes a null-geo row that is otherwise valid (title + price intact)", () => {
    const tour = makeTour({
      latitude: null,
      longitude: null,
      title: "Valid title",
      price_minor: 2800,
    });

    expect(validateTour(tour).ok).toBe(true);
  });

  it("but null PRICE is NOT a pass — the two fields differ (asymmetry)", () => {
    // The deliberate contrast, kept next to the null-geo tests: null geo passes
    // (a routine data-source gap), null price quarantines (a priceless tour
    // can't function on an affiliate-booking site).
    expect(validateTour(makeTour({ latitude: null, longitude: null })).ok).toBe(
      true,
    );
    expect(codes(makeTour({ price_minor: null }))).toEqual(["MISSING_PRICE"]);
  });

  it("still quarantines a null-geo row for an UNRELATED reason (null price)", () => {
    // Null geo alone is fine, but it must not mask a genuine failure elsewhere:
    // a null-geo, null-price row quarantines for the price reason only.
    const codesFor = codes(
      makeTour({ latitude: null, longitude: null, price_minor: null }),
    );
    expect(codesFor).toEqual(["MISSING_PRICE"]);
  });
});

describe("validateTour — multiple failures", () => {
  it("reports every failed rule at once, not just the first", () => {
    const codesFor = codes(
      makeTour({ title: "", price_minor: -1, latitude: 999, longitude: 10 }),
    );
    expect(codesFor).toEqual([
      "MISSING_TITLE",
      "NON_POSITIVE_PRICE",
      "COORDINATES_OUT_OF_RANGE",
    ]);
  });
});

/** In-memory {@link QuarantineStore}; records everything it was asked to retain. */
class FakeQuarantineStore implements QuarantineStore {
  readonly saved: QuarantineRecord[] = [];

  save(record: QuarantineRecord): Promise<void> {
    this.saved.push(record);
    return Promise.resolve();
  }
}

describe("TourValidator — persistence, retention, and counting", () => {
  it("retains the full payload + reasons and counts a quarantine", async () => {
    const store = new FakeQuarantineStore();
    const validator = new TourValidator(store);
    const stats = new ImportRunStats();
    const bad = makeTour({ title: "" });

    const result = await validator.process(bad, stats);

    expect(result.ok).toBe(false);
    // Payload retained verbatim — not discarded.
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0].tour).toEqual(bad);
    expect(store.saved[0].reasons.map((r) => r.code)).toEqual(["MISSING_TITLE"]);
    // Counter incremented.
    expect(stats.quarantined).toBe(1);
    expect(stats.processed).toBe(1);
  });

  it("does not persist or count a passing tour as quarantined", async () => {
    const store = new FakeQuarantineStore();
    const validator = new TourValidator(store);
    const stats = new ImportRunStats();

    const result = await validator.process(makeTour(), stats);

    expect(result.ok).toBe(true);
    expect(store.saved).toHaveLength(0);
    expect(stats.quarantined).toBe(0);
    expect(stats.processed).toBe(1);
  });

  it("counts quarantines across a mixed batch correctly", async () => {
    const store = new FakeQuarantineStore();
    const validator = new TourValidator(store);
    const stats = new ImportRunStats();

    const batch = [
      makeTour(), // pass
      makeTour({ title: "" }), // quarantine
      makeTour({ latitude: null, longitude: null }), // pass (null geo)
      makeTour({ price_minor: 0 }), // quarantine
      makeTour({ latitude: 200, longitude: 5 }), // quarantine
    ];
    for (const tour of batch) await validator.process(tour, stats);

    expect(stats.processed).toBe(5);
    expect(stats.quarantined).toBe(3);
    expect(store.saved).toHaveLength(3);
  });
});
