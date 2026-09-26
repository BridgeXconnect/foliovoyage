import { describe, expect, it } from "@jest/globals";

import { CURATED_CITIES } from "./curated-cities";
import type { LocationCandidate } from "./location-candidates";
import {
  anchorFor,
  distanceKm,
  fallbackPosition,
  NEAR_CITY_RADIUS_KM,
  pickCandidatePosition,
  pickTourPosition,
  resolveExperiencePosition,
  subRegionForTour,
  type LatLng,
} from "./position";

const city = (slug: string) => CURATED_CITIES.find((c) => c.slug === slug)!;
const HANOI = city("hanoi");
const BALI = city("bali");
const BANGKOK = city("bangkok");
const centroidOf = (c: typeof HANOI): LatLng => ({
  latitude: c.centroidLat,
  longitude: c.centroidLng,
});

const NEAR_HANOI = { latitude: 21.03, longitude: 105.85 };
const NEAR_HANOI_2 = { latitude: 21.04, longitude: 105.86 };
const HA_LONG = { latitude: 20.95, longitude: 107.08 }; // ~135 km east of Hanoi

const cand = (source: LocationCandidate["source"], ref: string): LocationCandidate => ({
  source,
  ref,
});

describe("pickCandidatePosition — priority order (first match wins)", () => {
  const all = [cand("poi", "P"), cand("pickup", "K"), cand("start", "S"), cand("end", "E")];
  const at = (m: Record<string, LatLng>) => new Map(Object.entries(m));

  it("takes the POI when it resolves, even if lower sources also do", () => {
    const out = pickCandidatePosition(
      all,
      at({ P: NEAR_HANOI, K: NEAR_HANOI_2, S: NEAR_HANOI_2, E: NEAR_HANOI_2 }),
      centroidOf(HANOI),
    );
    expect(out).toEqual({ ...NEAR_HANOI, basis: "poi" });
  });

  it("falls through to pickup when no POI resolves", () => {
    const out = pickCandidatePosition(all, at({ K: NEAR_HANOI_2, S: NEAR_HANOI }), centroidOf(HANOI));
    expect(out).toEqual({ ...NEAR_HANOI_2, basis: "pickup" });
  });

  it("falls through to start when neither POI nor pickup resolves", () => {
    const out = pickCandidatePosition(all, at({ S: NEAR_HANOI, E: NEAR_HANOI_2 }), centroidOf(HANOI));
    expect(out).toEqual({ ...NEAR_HANOI, basis: "start" });
  });

  it("falls through to end last", () => {
    const out = pickCandidatePosition(all, at({ E: NEAR_HANOI_2 }), centroidOf(HANOI));
    expect(out).toEqual({ ...NEAR_HANOI_2, basis: "end" });
  });

  it("returns null when nothing resolves", () => {
    expect(pickCandidatePosition(all, new Map(), centroidOf(HANOI))).toBeNull();
    expect(pickCandidatePosition([], new Map(), centroidOf(HANOI))).toBeNull();
  });

  it("skips unresolved candidates within a source and takes the next resolved one", () => {
    const two = [cand("poi", "P1"), cand("poi", "P2")];
    const out = pickCandidatePosition(two, at({ P2: NEAR_HANOI }), centroidOf(HANOI));
    expect(out).toEqual({ ...NEAR_HANOI, basis: "poi" });
  });
});

describe("pickCandidatePosition — near-city sanity check", () => {
  const anchor = centroidOf(HANOI);

  it("uses a 40 km radius", () => {
    expect(NEAR_CITY_RADIUS_KM).toBe(40);
    expect(distanceKm(anchor, HA_LONG)).toBeGreaterThan(100);
  });

  it("skips a far POI and takes the next candidate that is near", () => {
    const out = pickCandidatePosition(
      [cand("poi", "FAR"), cand("pickup", "NEAR")],
      new Map([["FAR", HA_LONG], ["NEAR", NEAR_HANOI]]),
      anchor,
    );
    expect(out).toEqual({ ...NEAR_HANOI, basis: "pickup" });
  });

  it("returns null when every resolved candidate is far", () => {
    const out = pickCandidatePosition(
      [cand("poi", "FAR"), cand("start", "FAR2")],
      new Map([["FAR", HA_LONG], ["FAR2", HA_LONG]]),
      anchor,
    );
    expect(out).toBeNull();
  });

  it("applies no check when there is no anchor", () => {
    const out = pickCandidatePosition([cand("poi", "FAR")], new Map([["FAR", HA_LONG]]), null);
    expect(out).toEqual({ ...HA_LONG, basis: "poi" });
  });
});

describe("anchors and the Bali sub-region tier", () => {
  it("anchors a plain city on its centroid", () => {
    expect(anchorFor({ curated: HANOI, centroid: centroidOf(HANOI) }, ["351"])).toEqual(
      centroidOf(HANOI),
    );
  });

  it("anchors a Bali tour on its sub-region centre", () => {
    const anchor = anchorFor({ curated: BALI, centroid: centroidOf(BALI) }, ["5467"]);
    expect(anchor).toMatchObject({ latitude: -8.5192680019, longitude: 115.2632979979 });
  });

  it("has no anchor for a Bali tour carrying only the region ref", () => {
    expect(anchorFor({ curated: BALI, centroid: centroidOf(BALI) }, ["98"])).toBeNull();
  });

  it("accepts a coastal Pemuteran point for a Pemuteran tour but not for an Ubud one", () => {
    const pemuteran = { latitude: -8.15, longitude: 114.65 };
    const c = [cand("poi", "X")];
    const resolved = new Map([["X", pemuteran]]);
    const inPemuteran = pickTourPosition({ candidates: c, destinationRefs: ["51549"], resolved });
    const inUbud = pickTourPosition({ candidates: c, destinationRefs: ["5467"], resolved });
    expect(inPemuteran?.basis).toBe("poi");
    expect(inUbud).toBeNull();
  });

  it("uses the first sub-region ref for a multi-destination tour", () => {
    const sub = subRegionForTour(BALI, ["34198", "5467"]);
    expect(sub?.name).toBe("Seminyak");
  });

  it("returns null from pickTourPosition for a tour in no curated city", () => {
    expect(
      pickTourPosition({ candidates: [cand("poi", "X")], destinationRefs: ["999999"], resolved: new Map([["X", NEAR_HANOI]]) }),
    ).toBeNull();
  });
});

describe("fallbackPosition — Bali sub-region, then city centroid", () => {
  it("fires for a Bali tour: the sub-region centre", () => {
    const out = fallbackPosition({ curated: BALI, centroid: centroidOf(BALI) }, ["22290"]);
    expect(out).toMatchObject({ basis: "subregion", latitude: -8.7238, longitude: 115.17523 });
  });

  it("falls back to the city centroid for a Bali tour with no sub-region ref", () => {
    const out = fallbackPosition({ curated: BALI, centroid: centroidOf(BALI) }, ["98"]);
    expect(out).toEqual({ ...centroidOf(BALI), basis: "city" });
  });

  it("does NOT fire for a non-Bali tour: it gets the city centroid", () => {
    for (const c of [HANOI, BANGKOK]) {
      const out = fallbackPosition({ curated: c, centroid: centroidOf(c) }, [c.primaryRef]);
      expect(out).toEqual({ ...centroidOf(c), basis: "city" });
    }
  });

  it("does not hand a non-Bali tour a Bali sub-region position, even if it carries a Bali ref", () => {
    // Registry order resolves this tour to Bangkok (listed before Bali).
    const refs = ["343", "5467"];
    const curated = BANGKOK;
    const out = fallbackPosition({ curated, centroid: centroidOf(curated) }, refs);
    expect(out?.basis).toBe("city");
  });

  it("returns null when the city has no centroid and there is no sub-region", () => {
    expect(fallbackPosition({ curated: HANOI, centroid: null }, ["351"])).toBeNull();
  });
});

describe("resolveExperiencePosition", () => {
  const cityGeo = { curated: HANOI, centroid: centroidOf(HANOI) };

  it("uses the tour's own pair when both halves are present", () => {
    const out = resolveExperiencePosition({
      tourLatitude: 21.1,
      tourLongitude: 105.9,
      city: cityGeo,
      destinationRefs: ["351"],
    });
    expect(out).toEqual({ latitude: 21.1, longitude: 105.9, basis: "tour" });
  });

  it("ignores a half pair and falls back rather than mixing halves", () => {
    const out = resolveExperiencePosition({
      tourLatitude: 21.1,
      tourLongitude: null,
      city: cityGeo,
      destinationRefs: ["351"],
    });
    expect(out).toEqual({ ...centroidOf(HANOI), basis: "city" });
  });
});
