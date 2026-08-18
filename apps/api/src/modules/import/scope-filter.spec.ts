import { describe, expect, it } from "@jest/globals";

import type { ViatorProduct } from "./clients/viator.types";
import { decideIngestScope } from "./scope-filter";

/** A raw product in a curated destination (Bangkok, ref "343"), active, instant. */
function curatedActiveProduct(overrides: Record<string, unknown> = {}): ViatorProduct {
  return {
    productCode: "X1",
    title: "T",
    status: "ACTIVE",
    destinations: [{ ref: "343", primary: true }],
    bookingConfirmationSettings: { confirmationType: "INSTANT" },
    ...overrides,
  };
}

describe("decideIngestScope", () => {
  it("ingests a curated, active, instant-confirmation product", () => {
    expect(decideIngestScope(curatedActiveProduct())).toEqual({ ingest: true });
  });

  it("skips a product outside the curated destinations", () => {
    const raw = curatedActiveProduct({ destinations: [{ ref: "999" }] });
    expect(decideIngestScope(raw)).toEqual({
      ingest: false,
      reason: "NOT_CURATED_DESTINATION",
    });
  });

  it("skips a product with no destinations at all", () => {
    const raw = curatedActiveProduct({ destinations: undefined });
    expect(decideIngestScope(raw)).toEqual({
      ingest: false,
      reason: "NOT_CURATED_DESTINATION",
    });
  });

  it("skips an INACTIVE product even in a curated destination", () => {
    // Real INACTIVE payloads carry almost no other fields — mirror that.
    const raw: ViatorProduct = {
      status: "INACTIVE",
      productCode: "X2",
      destinations: [{ ref: "343" }],
    };
    expect(decideIngestScope(raw)).toEqual({ ingest: false, reason: "INACTIVE" });
  });

  it("treats a missing status as not ingestible (only explicit ACTIVE passes)", () => {
    const raw = curatedActiveProduct({ status: undefined });
    expect(decideIngestScope(raw)).toEqual({ ingest: false, reason: "INACTIVE" });
  });

  it("skips a MANUAL confirmation product", () => {
    const raw = curatedActiveProduct({
      bookingConfirmationSettings: { confirmationType: "MANUAL" },
    });
    expect(decideIngestScope(raw)).toEqual({
      ingest: false,
      reason: "MANUAL_CONFIRMATION",
    });
  });

  it("skips an INSTANT_THEN_MANUAL confirmation product", () => {
    const raw = curatedActiveProduct({
      bookingConfirmationSettings: { confirmationType: "INSTANT_THEN_MANUAL" },
    });
    expect(decideIngestScope(raw)).toEqual({
      ingest: false,
      reason: "MANUAL_CONFIRMATION",
    });
  });

  it("ingests when bookingConfirmationSettings is absent (doesn't fabricate an exclusion)", () => {
    const raw = curatedActiveProduct({ bookingConfirmationSettings: undefined });
    expect(decideIngestScope(raw)).toEqual({ ingest: true });
  });

  it("checks destination before status — a non-curated inactive product reports NOT_CURATED_DESTINATION", () => {
    const raw: ViatorProduct = {
      status: "INACTIVE",
      productCode: "X3",
      destinations: [{ ref: "999" }],
    };
    expect(decideIngestScope(raw)).toEqual({
      ingest: false,
      reason: "NOT_CURATED_DESTINATION",
    });
  });

  it("matches a Bali sub-destination ref (region registry entry)", () => {
    const raw = curatedActiveProduct({ destinations: [{ ref: "34198" }] }); // Seminyak
    expect(decideIngestScope(raw)).toEqual({ ingest: true });
  });
});
