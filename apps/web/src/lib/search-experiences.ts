/**
 * Pure search + filter engine for /search (ST-13 free-text, ST-16 facets),
 * over the STATIC content system — see the plan's Decision 1 for why static,
 * not the live `GET /v1/search`, is the source today. No next/posthog imports,
 * so ts-jest runs this in node.
 *
 * Shape and semantics deliberately echo the API service (mixed Experience +
 * Destination results; destinations excluded once an experience-only filter is
 * set; empty query = "featured" with destinations first) so swapping this for a
 * live `fetch('/v1/search?...')` later is a data-layer change behind the same
 * URL params (search-url.ts) and the same cards.
 */
import type {
  Destination,
  Experience,
  ExperienceCategory,
  PriceBand,
} from "@folio/shared";
import { getAllDestinations } from "@/data/destinations-helpers";
import type { DurationBucket, SearchState } from "@/lib/search-url";

const DEFAULT_PAGE_SIZE = 12;

export interface SearchResultExperience {
  type: "experience";
  experience: Experience;
  destination: { slug: string; city: string; country: string };
  score: number;
}
export interface SearchResultDestination {
  type: "destination";
  destination: Destination;
  score: number;
}
export type SearchResult = SearchResultExperience | SearchResultDestination;

export interface FacetCount<T extends string> {
  value: T;
  count: number;
}
export interface SearchFacets {
  priceBands: FacetCount<PriceBand>[];
  categories: FacetCount<ExperienceCategory>[];
  durations: FacetCount<DurationBucket>[];
}
export interface SearchOutcome {
  query: string;
  results: SearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets: SearchFacets;
}

const DURATION_LABEL_TO_BUCKET: Record<string, DurationBucket> = {
  "1 hour": "short",
  "1–2 hours": "short",
  "2 hours": "short",
  "2–3 hours": "short",
  Evening: "short",
  "Half day": "half-day",
  "Full day": "full-day",
  "1–2 days": "multi-day",
};

export function durationBucketOf(label: string | undefined): DurationBucket | null {
  if (!label) return null;
  return DURATION_LABEL_TO_BUCKET[label] ?? null;
}

/**
 * True when any experience-only filter is set. Destinations carry no price,
 * category, or duration, so when this is true destinations are dropped
 * entirely — mirroring the API's `hasExperienceFilters` AND-contract exception.
 */
export function hasExperienceFilters(state: SearchState): boolean {
  return Boolean(
    state.priceBands.length ||
      state.categories.length ||
      state.durations.length,
  );
}

interface Corpus {
  experiences: SearchResultExperience[];
  destinations: SearchResultDestination[];
}

/** Flatten the static content into a mixed, still-unfiltered corpus. */
function buildCorpus(): Corpus {
  const destinations = getAllDestinations();
  const exp: SearchResultExperience[] = [];
  const dest: SearchResultDestination[] = [];
  for (const d of destinations) {
    dest.push({ type: "destination", destination: d, score: 0 });
    for (const e of d.experiences) {
      exp.push({
        type: "experience",
        experience: e,
        destination: { slug: d.slug, city: d.city, country: d.country },
        score: 0,
      });
    }
  }
  return { experiences: exp, destinations: dest };
}

function experienceHaystack(r: SearchResultExperience): string {
  const e = r.experience;
  return `${e.title} ${e.description} ${e.category} ${r.destination.city} ${r.destination.country}`.toLowerCase();
}

function destinationHaystack(r: SearchResultDestination): string {
  const d = r.destination;
  return `${d.city} ${d.country} ${d.tagline} ${d.knownFor.join(" ")} ${d.intro.join(" ")}`.toLowerCase();
}

/** Token score: +2 if title/name contains the token, +1 for any other field. */
function scoreExperience(r: SearchResultExperience, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const title = r.experience.title.toLowerCase();
  const hay = experienceHaystack(r);
  let score = 0;
  for (const t of tokens) {
    if (!hay.includes(t)) return -1; // AND: every token must appear somewhere
    score += title.includes(t) ? 2 : 1;
  }
  return score;
}

function scoreDestination(r: SearchResultDestination, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const name = `${r.destination.city} ${r.destination.country}`.toLowerCase();
  const hay = destinationHaystack(r);
  let score = 0;
  for (const t of tokens) {
    if (!hay.includes(t)) return -1;
    score += name.includes(t) ? 2 : 1;
  }
  return score;
}

function matchesFilters(r: SearchResultExperience, state: SearchState): boolean {
  const e = r.experience;
  if (state.priceBands.length && !state.priceBands.includes(e.priceBand)) return false;
  if (state.categories.length && !state.categories.includes(e.category)) return false;
  if (state.durations.length) {
    const bucket = durationBucketOf(e.duration);
    if (bucket === null || !state.durations.includes(bucket)) return false;
  }
  return true;
}

function countFacet<T extends string>(
  items: SearchResultExperience[],
  pick: (e: Experience) => T | null,
): FacetCount<T>[] {
  const counts = new Map<T, number>();
  for (const r of items) {
    const v = pick(r.experience);
    if (v === null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function runSearch(state: SearchState, pageSize = DEFAULT_PAGE_SIZE): SearchOutcome {
  const q = state.q.trim().toLowerCase();
  const tokens = q.length ? q.split(/\s+/).filter(Boolean) : [];
  const corpus = buildCorpus();
  const dropDestinations = hasExperienceFilters(state);

  // 1. Text-match both entity types.
  const matchedExperiences = corpus.experiences
    .map((r) => ({ ...r, score: scoreExperience(r, tokens) }))
    .filter((r) => r.score >= 0);
  const matchedDestinations = dropDestinations
    ? []
    : corpus.destinations
        .map((r) => ({ ...r, score: scoreDestination(r, tokens) }))
        .filter((r) => r.score >= 0);

  // 2. Facet counts over the query-matched experiences (before facet filters),
  //    so each chip shows how many results it would yield.
  const facets: SearchFacets = {
    priceBands: countFacet<PriceBand>(matchedExperiences, (e) => e.priceBand),
    categories: countFacet<ExperienceCategory>(matchedExperiences, (e) => e.category),
    durations: countFacet<DurationBucket>(matchedExperiences, (e) => durationBucketOf(e.duration)),
  };

  // 3. Apply facet filters to experiences.
  const filteredExperiences = matchedExperiences.filter((r) => matchesFilters(r, state));

  // 4. Merge + order. Empty query = featured (destinations first, data order);
  //    otherwise score-sorted with a stable title/name tie-break.
  let ordered: SearchResult[];
  if (tokens.length === 0) {
    ordered = [...matchedDestinations, ...filteredExperiences];
  } else {
    ordered = [...filteredExperiences, ...matchedDestinations].sort(
      (a, b) => b.score - a.score || sortName(a).localeCompare(sortName(b)),
    );
  }

  const total = ordered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, state.page), totalPages);
  const start = (page - 1) * pageSize;
  const results = ordered.slice(start, start + pageSize);

  return { query: state.q.trim(), results, total, page, pageSize, totalPages, facets };
}

function sortName(r: SearchResult): string {
  return r.type === "experience" ? r.experience.title : r.destination.city;
}
