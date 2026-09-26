import { describe, expect, it } from "@jest/globals";

import {
  extractLocationCandidates,
  MAX_CANDIDATES_PER_SOURCE,
} from "./location-candidates";

const loc = (ref: string) => ({ location: { ref } });

describe("extractLocationCandidates", () => {
  it("returns nothing for a payload with no refs", () => {
    expect(extractLocationCandidates({ productCode: "X" })).toEqual([]);
  });

  it("reads STANDARD itinerary items, MULTI_DAY day items and top-level POIs", () => {
    const out = extractLocationCandidates({
      itinerary: {
        itineraryItems: [{ pointOfInterestLocation: loc("LOC-a") }],
        days: [
          { items: [{ pointOfInterestLocation: loc("LOC-b") }] },
          { items: [{ pointOfInterestLocation: loc("LOC-c") }] },
        ],
        pointOfInterestLocations: [loc("LOC-d")],
      },
    });
    expect(out).toEqual([
      { source: "poi", ref: "LOC-a" },
      { source: "poi", ref: "LOC-b" },
      { source: "poi", ref: "LOC-c" },
      { source: "poi", ref: "LOC-d" },
    ]);
  });

  it("filters pickup sentinels that are not LOC- refs", () => {
    const out = extractLocationCandidates({
      logistics: {
        travelerPickup: {
          locations: [loc("MEET_AT_DEPARTURE_POINT"), loc("LOC-hotel")],
        },
      },
    });
    expect(out).toEqual([{ source: "pickup", ref: "LOC-hotel" }]);
  });

  it("reads per-option logistics after the product-level ones", () => {
    const out = extractLocationCandidates({
      logistics: { start: [loc("LOC-s0")], end: [loc("LOC-e0")] },
      productOptions: [
        {
          logistics: {
            start: [loc("LOC-s1")],
            end: [loc("LOC-e1")],
            travelerPickup: { locations: [loc("LOC-p1")] },
          },
        },
      ],
    });
    expect(out).toEqual([
      { source: "pickup", ref: "LOC-p1" },
      { source: "start", ref: "LOC-s0" },
      { source: "start", ref: "LOC-s1" },
      { source: "end", ref: "LOC-e0" },
      { source: "end", ref: "LOC-e1" },
    ]);
  });

  it("orders sources poi → pickup → start → end regardless of payload key order", () => {
    const out = extractLocationCandidates({
      logistics: {
        end: [loc("LOC-e")],
        start: [loc("LOC-s")],
        travelerPickup: { locations: [loc("LOC-p")] },
      },
      itinerary: { itineraryItems: [{ pointOfInterestLocation: loc("LOC-i") }] },
    });
    expect(out.map((c) => c.source)).toEqual(["poi", "pickup", "start", "end"]);
  });

  it("keeps a ref that appears in two sources under the higher-priority one only", () => {
    const out = extractLocationCandidates({
      logistics: { start: [loc("LOC-same")] },
      itinerary: { itineraryItems: [{ pointOfInterestLocation: loc("LOC-same") }] },
    });
    expect(out).toEqual([{ source: "poi", ref: "LOC-same" }]);
  });

  it("caps each source so a 600-hotel pickup list stays small", () => {
    const locations = Array.from({ length: 600 }, (_, i) => loc(`LOC-h${i}`));
    const out = extractLocationCandidates({
      logistics: { travelerPickup: { locations } },
    });
    expect(out).toHaveLength(MAX_CANDIDATES_PER_SOURCE.pickup);
    expect(out[0].ref).toBe("LOC-h0");
  });

  it("tolerates malformed shapes without throwing", () => {
    expect(
      extractLocationCandidates({
        itinerary: { itineraryItems: [null, 3, { pointOfInterestLocation: null }] },
        logistics: { start: "nope", travelerPickup: { locations: [{}] } },
        productOptions: [null, { logistics: null }],
      }),
    ).toEqual([]);
  });
});
