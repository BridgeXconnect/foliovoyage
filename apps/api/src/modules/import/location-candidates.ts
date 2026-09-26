import type { ViatorProduct } from "./clients/viator.types";

/**
 * Location-reference candidates (BRI-218).
 *
 * A Viator product carries no coordinates, only opaque `location.ref` values
 * (resolved via `/locations/bulk`). BRI-217 found the normalizer read exactly one
 * of them — `logistics.start[0]` — which resolves for only ~3.6% of tours
 * (99.8% of the unresolvable start refs are `provider: GOOGLE`, Place ID only,
 * no `center`). The same already-fetched payload carries many more refs, ~96% of
 * them TripAdvisor-provider *with* a `center`.
 *
 * This module is a **pure** extractor: it lists those refs in priority order and
 * says nothing about coordinates. Picking one (sanity check, fallbacks) is
 * `position.ts`'s job. Order, first match wins — no scoring or averaging:
 *
 *   1. `poi`     itinerary points of interest (what the tour actually visits)
 *   2. `pickup`  traveler pickup locations (reliably near the city)
 *   3. `start`   `logistics.start[]` (the pre-BRI-218 source; `[0]` first)
 *   4. `end`     `logistics.end[]`
 *
 * Attractions (`/attractions/*`) are deliberately NOT a source — see BRI-217/218
 * (marginal gain, unresolved BRI-204 compliance question).
 */

export type LocationSource = "poi" | "pickup" | "start" | "end";

/** Priority order, highest first. */
export const LOCATION_SOURCE_ORDER: readonly LocationSource[] = [
  "poi",
  "pickup",
  "start",
  "end",
];

export interface LocationCandidate {
  readonly source: LocationSource;
  /** A `LOC-…` Viator location reference. */
  readonly ref: string;
}

/**
 * Per-source cap on how many refs are offered for resolution. Pickup lists can
 * hold 600+ hotels (BRI-217 census), and every candidate costs a
 * `/locations/bulk` lookup, so only the first few are ever considered. The
 * resolver tries them in payload order and takes the first usable one.
 */
export const MAX_CANDIDATES_PER_SOURCE: Readonly<Record<LocationSource, number>> = {
  poi: 20,
  pickup: 5,
  start: 5,
  end: 5,
};

/**
 * Only real location refs. `travelerPickup.locations[].location.ref` mixes in
 * sentinels such as `"MEET_AT_DEPARTURE_POINT"`, which are not resolvable.
 */
const LOC_REF = /^LOC-/;

/** Extract every candidate ref from a raw product, in priority order. */
export function extractLocationCandidates(
  raw: ViatorProduct,
): LocationCandidate[] {
  const bySource: Record<LocationSource, string[]> = {
    poi: poiRefs(raw),
    pickup: pickupRefs(raw),
    start: logisticsRefs(raw, "start"),
    end: logisticsRefs(raw, "end"),
  };

  const seen = new Set<string>();
  const out: LocationCandidate[] = [];
  for (const source of LOCATION_SOURCE_ORDER) {
    let taken = 0;
    for (const ref of bySource[source]) {
      // A ref reachable from a higher-priority source keeps that source.
      if (seen.has(ref)) continue;
      if (taken >= MAX_CANDIDATES_PER_SOURCE[source]) break;
      seen.add(ref);
      out.push({ source, ref });
      taken += 1;
    }
  }
  return out;
}

// --- per-source readers -----------------------------------------------------

/**
 * Itinerary POIs. Verified against real payloads (raw archive 2026-09-17):
 * `STANDARD` itineraries list `itinerary.itineraryItems[]`, `MULTI_DAY_TOUR`
 * nests them as `itinerary.days[].items[]`; either way each item's ref is
 * `pointOfInterestLocation.location.ref`. A top-level
 * `itinerary.pointOfInterestLocations[]` is read defensively — it was not seen
 * in the sampled key union but the API docs list it.
 */
function poiRefs(raw: ViatorProduct): string[] {
  const itinerary = asRecord(raw.itinerary);
  if (!itinerary) return [];

  const refs: unknown[] = [];
  for (const item of asArray(itinerary.itineraryItems)) {
    refs.push(poiRef(item));
  }
  for (const day of asArray(itinerary.days)) {
    for (const item of asArray(asRecord(day)?.items)) refs.push(poiRef(item));
  }
  for (const poi of asArray(itinerary.pointOfInterestLocations)) {
    refs.push(locationRef(poi));
  }
  return refs.filter(isLocRef);
}

function poiRef(item: unknown): unknown {
  return locationRef(asRecord(item)?.pointOfInterestLocation);
}

/**
 * Traveler pickup locations: product level, then per-option
 * (`productOptions[].logistics.travelerPickup.locations[]`).
 */
function pickupRefs(raw: ViatorProduct): string[] {
  const refs: unknown[] = [];
  const top = asRecord(asRecord(raw.logistics)?.travelerPickup);
  for (const loc of asArray(top?.locations)) refs.push(locationRef(loc));
  for (const option of asArray(raw.productOptions)) {
    const pickup = asRecord(
      asRecord(asRecord(option)?.logistics)?.travelerPickup,
    );
    for (const loc of asArray(pickup?.locations)) refs.push(locationRef(loc));
  }
  return refs.filter(isLocRef);
}

/**
 * `logistics.start[]` / `logistics.end[]`: product level first (so `start[0]`,
 * the pre-BRI-218 source, leads the tier), then per-option.
 */
function logisticsRefs(raw: ViatorProduct, field: "start" | "end"): string[] {
  const refs: unknown[] = [];
  for (const entry of asArray(asRecord(raw.logistics)?.[field])) {
    refs.push(locationRef(entry));
  }
  for (const option of asArray(raw.productOptions)) {
    for (const entry of asArray(
      asRecord(asRecord(option)?.logistics)?.[field],
    )) {
      refs.push(locationRef(entry));
    }
  }
  return refs.filter(isLocRef);
}

// --- tiny shape helpers -----------------------------------------------------

/** `{ location: { ref } }` → `ref`. */
function locationRef(entry: unknown): unknown {
  return asRecord(asRecord(entry)?.location)?.ref;
}

function isLocRef(value: unknown): value is string {
  return typeof value === "string" && LOC_REF.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
