/**
 * Pure URL-state contract for /search (ST-16: "state is in the URL; reloading
 * reproduces results"). No next/posthog imports, so ts-jest runs it in node.
 *
 * Param names mirror the API's `GET /v1/search` where the public static corpus
 * supports them (`q`, `priceBand`, `page`). Provider ratings are protected, so
 * the static search does not accept a rating filter. `category` and `duration` are
 * additive facets the static content system carries; `duration` uses categorical
 * buckets because the static `Experience.duration` is free-text labels, not
 * minutes (mapping labels to fake minutes would invent data — see the plan's
 * Decision 3). When the minute-based API becomes the source, buckets map to
 * min/max minute ranges behind the same control.
 */
import type { ExperienceCategory, PriceBand } from "@folio/shared";

export type DurationBucket = "short" | "half-day" | "full-day" | "multi-day";

export const VALID_PRICE_BANDS: readonly PriceBand[] = ["$", "$$", "$$$", "$$$$"];
export const VALID_CATEGORIES: readonly ExperienceCategory[] = [
  "Culture & History",
  "Food & Drink",
  "Nature & Outdoors",
  "Landmarks",
  "Neighbourhoods",
  "Nightlife",
  "Day Trips",
  "Wellness",
  "Water & Coast",
];
export const VALID_DURATIONS: readonly DurationBucket[] = [
  "short",
  "half-day",
  "full-day",
  "multi-day",
];

export interface SearchState {
  q: string;
  priceBands: PriceBand[];
  categories: ExperienceCategory[];
  durations: DurationBucket[];
  page: number;
}

export const EMPTY_SEARCH_STATE: SearchState = {
  q: "",
  priceBands: [],
  categories: [],
  durations: [],
  page: 1,
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function tokens<T extends string>(
  v: string | string[] | undefined,
  valid: readonly T[],
): T[] {
  const raw = first(v);
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t): t is T => (valid as readonly string[]).includes(t));
}

export function parseSearchState(
  params: Record<string, string | string[] | undefined>,
): SearchState {
  const q = (first(params.q) ?? "").trim();
  const priceBands = tokens(params.priceBand, VALID_PRICE_BANDS);
  const categories = tokens(params.category, VALID_CATEGORIES);
  const durations = tokens(params.duration, VALID_DURATIONS);

  const rawPage = first(params.page);
  const parsedPage = rawPage !== undefined ? Number(rawPage) : NaN;
  const page = Number.isFinite(parsedPage) ? Math.max(1, Math.trunc(parsedPage)) : 1;

  return { q, priceBands, categories, durations, page };
}

export function searchStateToQuery(state: SearchState): string {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.priceBands.length) p.set("priceBand", state.priceBands.join(","));
  if (state.categories.length) p.set("category", state.categories.join(","));
  if (state.durations.length) p.set("duration", state.durations.join(","));
  if (state.page > 1) p.set("page", String(state.page));
  return p.toString();
}
