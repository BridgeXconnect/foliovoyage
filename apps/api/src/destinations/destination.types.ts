/**
 * Response shape for `GET /v1/destinations/:country/:city` (ST-5 / BRI-100,
 * extended for ST-11 / BRI-164 and for AI tour copy, BRI-154 / spec 0002).
 *
 * The endpoint now returns the city's **published** Experiences (draft ones are
 * invisible to the public site), paginated, each carrying the provider-owned
 * fields its card renders — sourced from the Experience's linked Tour. Fields
 * that Atlas hasn't curated yet are honestly nullable/empty: `editorRating` is
 * null until an editor sets it, `tags` is empty until curation, and
 * `affiliateUrl` is omitted so the card shows a "coming soon" placeholder rather
 * than a live booking link.
 */

/** Rough price signal, mirrors `@folio/shared`'s `PriceBand`. */
export type PriceBand = "$" | "$$" | "$$$" | "$$$$";

export interface ExperienceResponse {
  id: string;
  title: string;
  description: string;
  /** Provider cover image (from the linked Tour), or null when none. */
  imageUrl: string | null;
  /** Alt text for {@link imageUrl}, or null. */
  imageAlt: string | null;
  /** Atlas editorial rating (0–5), or null until an editor sets it. */
  editorRating: number | null;
  /** Rough price band derived from the linked Tour's price, or null when unpriced. */
  priceBand: PriceBand | null;
  /** Curated tags. Empty until editorial curation (M7). */
  tags: string[];
  /**
   * AI-generated summary of the linked Tour (BRI-154), or null. Null covers
   * every case but one: no `TourCopy` row yet, the row is `failed`, its
   * `groundingHash` no longer matches the tour's current fields, or the tour
   * is no longer eligible (AC-12). Untrusted third-party-grounded text —
   * whoever renders it must escape it.
   */
  aiSummary: string | null;
  /**
   * Live affiliate deep link, when present. Omitted for auto-created imports —
   * its absence is what makes the card render a "coming soon" placeholder (the
   * confirmed swap seam). Reserved for when review/curation attaches one.
   */
  affiliateUrl?: string;
  /** Affiliate provider label, paired with {@link affiliateUrl}. */
  provider?: string;
}

/** Page metadata for the experiences list. */
export interface PaginationMeta {
  /** 1-based current page. */
  page: number;
  /** Items per page. */
  pageSize: number;
  /** Total published experiences for the city. */
  total: number;
  /** Total pages (at least 1). */
  totalPages: number;
}

export interface DestinationResponse {
  city: string;
  citySlug: string;
  country: string;
  countrySlug: string;
  heroImageUrl: string;
  heroImageAlt: string;
  experiences: ExperienceResponse[];
  pagination: PaginationMeta;
}
