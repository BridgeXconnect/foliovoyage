import { curatedCityForRefs, type CuratedCity } from "./curated-cities";
import type { LocationCandidate, LocationSource } from "./location-candidates";

/**
 * Experience/Tour position resolution (BRI-218) — pure functions, no I/O.
 *
 * Two stages, shared by the ingest pipeline, the {@link ExperienceLinker} and the
 * backfill CLI so they can never disagree:
 *
 * 1. {@link pickCandidatePosition} — walk the tour's location candidates in
 *    priority order (`location-candidates.ts`) and take the **first** one that
 *    resolved to coordinates and passes the near-city sanity check. First match
 *    wins; nothing is scored or averaged.
 * 2. {@link fallbackPosition} — when no candidate is usable: the tour's Bali
 *    sub-region centre (Bali only), then the city centroid.
 *
 * ### Near-city sanity check — decided from data, not assumed
 *
 * BRI-217's 816-tour raw-archive sample measured the distance of the first
 * resolvable ref per source from the city centroid: itinerary POIs are often
 * far away (>40 km for Hanoi 68/268, Lisbon 31/101, Rome 18/171, Bangkok 12/41,
 * Bali 29/101 — day trips, and TripAdvisor POIs the tour merely passes), while
 * pickup points are reliably near the city (Hanoi p90 2.2 km, Rome 4.8,
 * Lisbon 5.9). A tour "in Hanoi" positioned at Ha Long Bay is wrong for a map
 * pin. So the check is applied **per candidate**: a far candidate is skipped and
 * the next one is tried, instead of the tour giving up. {@link NEAR_CITY_RADIUS_KM}
 * is 40 km, measured from the tour's *anchor*: its Bali sub-region centre if it
 * has one, else the city centroid. Bali is a region — its inland island-wide
 * centroid is up to ~67 km from real coastal tours (Pemuteran) — so a Bali tour
 * with no sub-region ref has **no anchor and no check** rather than a wrong one.
 */

/** A candidate further than this from the tour's anchor is skipped. */
export const NEAR_CITY_RADIUS_KM = 40;

/** Where a position came from. Ordered roughly best → worst. */
export type PositionBasis = LocationSource | "tour" | "subregion" | "city";

export interface Position {
  readonly latitude: number;
  readonly longitude: number;
  readonly basis: PositionBasis;
}

export interface LatLng {
  readonly latitude: number;
  readonly longitude: number;
}

/** Bases that mean "a real place, not a fallback". */
export const REAL_BASES: ReadonlySet<PositionBasis> = new Set([
  "poi",
  "pickup",
  "start",
  "end",
  "tour",
]);

/** Great-circle distance in km (haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface CityGeo {
  /** The curated city (from the registry) the tour belongs to. */
  readonly curated: CuratedCity;
  /** The stored City centroid; falls back to the registry's when absent. */
  readonly centroid: LatLng | null;
}

/** Resolve a tour's city from its destination refs (as the linker does). */
export function cityForTour(
  destinationRefs: readonly string[],
): CuratedCity | null {
  return curatedCityForRefs(destinationRefs);
}

/**
 * The tour's Bali-style sub-region: the **first** ref in `destinationRefs`
 * (payload order, primary first) that is a known sub-region of the city.
 * Multi-destination tours get one position, from that first ref.
 */
export function subRegionForTour(
  curated: CuratedCity,
  destinationRefs: readonly string[],
): { ref: string; name: string; latitude: number; longitude: number } | null {
  if (!curated.subRegions) return null;
  for (const ref of destinationRefs) {
    const hit = curated.subRegions.find((s) => s.ref === ref);
    if (hit) {
      return { ref: hit.ref, name: hit.name, latitude: hit.lat, longitude: hit.lng };
    }
  }
  return null;
}

/**
 * The point candidates are measured against, or `null` for "don't check".
 * Sub-region centre where the city has sub-regions and the tour carries one; no
 * anchor for a sub-regioned city (Bali) whose tour carries none; otherwise the
 * city centroid.
 */
export function anchorFor(
  city: CityGeo,
  destinationRefs: readonly string[],
): LatLng | null {
  const sub = subRegionForTour(city.curated, destinationRefs);
  if (sub) return sub;
  if (city.curated.subRegions) return null;
  return city.centroid ?? {
    latitude: city.curated.centroidLat,
    longitude: city.curated.centroidLng,
  };
}

/**
 * First candidate (in the order given) that resolved and is within
 * {@link NEAR_CITY_RADIUS_KM} of `anchor` (no `anchor` → no check). `null` when
 * none qualify.
 */
export function pickCandidatePosition(
  candidates: readonly LocationCandidate[],
  resolved: ReadonlyMap<string, LatLng>,
  anchor: LatLng | null,
): Position | null {
  for (const candidate of candidates) {
    const point = resolved.get(candidate.ref);
    if (!point) continue;
    if (anchor && distanceKm(point, anchor) > NEAR_CITY_RADIUS_KM) continue;
    return {
      latitude: point.latitude,
      longitude: point.longitude,
      basis: candidate.source,
    };
  }
  return null;
}

/**
 * Convenience over the two steps above: pick from candidates for a tour whose
 * curated city is derived from its own `destinationRefs`. Returns `null` when
 * the tour maps to no curated city (nothing to anchor against — the ingest scope
 * filter should never let that through, but stay total).
 */
export function pickTourPosition(
  input: {
    candidates: readonly LocationCandidate[];
    destinationRefs: readonly string[];
    resolved: ReadonlyMap<string, LatLng>;
    /** Stored City centroid, if known; defaults to the registry's. */
    centroid?: LatLng | null;
  },
): Position | null {
  const curated = cityForTour(input.destinationRefs);
  if (!curated) return null;
  const anchor = anchorFor(
    { curated, centroid: input.centroid ?? null },
    input.destinationRefs,
  );
  return pickCandidatePosition(input.candidates, input.resolved, anchor);
}

/**
 * The no-real-location fallback: the Bali sub-region centre when the tour
 * carries one (only cities with `subRegions` — a non-Bali tour never gets a
 * sub-region position), else the city centroid, else `null` (the linker turns
 * that into {@link ExperienceGeoUnavailableError}).
 */
export function fallbackPosition(
  city: CityGeo,
  destinationRefs: readonly string[],
): Position | null {
  const sub = subRegionForTour(city.curated, destinationRefs);
  if (sub) {
    return { latitude: sub.latitude, longitude: sub.longitude, basis: "subregion" };
  }
  if (city.centroid) {
    return { ...city.centroid, basis: "city" };
  }
  return null;
}

/**
 * The position an Experience should carry: the tour's own resolved pair when
 * both halves are present (never a half-pair — see the linker's note), else the
 * {@link fallbackPosition}.
 */
export function resolveExperiencePosition(input: {
  tourLatitude: number | null;
  tourLongitude: number | null;
  city: CityGeo;
  destinationRefs: readonly string[];
}): Position | null {
  if (input.tourLatitude !== null && input.tourLongitude !== null) {
    return {
      latitude: input.tourLatitude,
      longitude: input.tourLongitude,
      basis: "tour",
    };
  }
  return fallbackPosition(input.city, input.destinationRefs);
}
