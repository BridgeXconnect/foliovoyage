import type { PriceBand } from "../destinations/destination.types";

/**
 * Response shape for `GET /v1/search?q=` (ST-13 / BRI-125).
 *
 * A single ranked list mixing two entity types — Experiences and
 * Destinations (Cities) — per the story AC. Each result carries its own
 * `score` (the blended rank it was sorted by) so the client can render a
 * relevance-ordered list without re-deriving anything.
 */

export interface SearchExperienceResult {
  type: "experience";
  id: string;
  title: string;
  description: string;
  /** Provider cover image (from the linked Tour), or null when none. */
  imageUrl: string | null;
  imageAlt: string | null;
  /** Atlas editorial rating (0–5), or null until an editor sets it. */
  editorRating: number | null;
  priceBand: PriceBand | null;
  /** Parent destination, for the card's "in {city}" context line. */
  city: string;
  citySlug: string;
  countrySlug: string;
  /** Blended relevance score this result was ranked by. */
  score: number;
}

export interface SearchDestinationResult {
  type: "destination";
  citySlug: string;
  countrySlug: string;
  name: string;
  country: string;
  heroImageUrl: string;
  heroImageAlt: string;
  /** Blended relevance score this result was ranked by. */
  score: number;
}

export type SearchResultItem = SearchExperienceResult | SearchDestinationResult;

export interface SearchPaginationMeta {
  page: number;
  pageSize: number;
  /** Total matched results across both entity types. */
  total: number;
  totalPages: number;
}

export interface SearchResponse {
  /** The (trimmed) query that produced these results; empty for the featured fallback. */
  query: string;
  results: SearchResultItem[];
  pagination: SearchPaginationMeta;
}
