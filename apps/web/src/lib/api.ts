/**
 * Tiny server-side client for the Folio Voyage API (ST-5 / BRI-100, extended for
 * ST-11 / BRI-164).
 *
 * Destination data is read server-side from the NestJS API (which reads
 * Postgres) — never hardcoded in the frontend. For an imported city this returns
 * the DB's published Experiences (with their linked Tour's image + price),
 * paginated.
 */

/** Base URL of the API. Server-side only; defaults to the local dev port. */
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

export type PriceBand = "$" | "$$" | "$$$" | "$$$$";

export interface ApiExperience {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  imageAlt: string | null;
  editorRating: number | null;
  priceBand: PriceBand | null;
  tags: string[];
  /** Present only once a live booking link is attached; absent → "coming soon". */
  affiliateUrl?: string;
  provider?: string;
}

export interface ApiPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiDestination {
  city: string;
  citySlug: string;
  country: string;
  countrySlug: string;
  heroImageUrl: string;
  heroImageAlt: string;
  experiences: ApiExperience[];
  pagination: ApiPagination;
}

/** Options for a paginated destination fetch. */
export interface FetchDestinationOptions {
  page?: number;
  pageSize?: number;
}

/**
 * Fetch one destination by country/city slug.
 *
 * Returns `null` when the API reports the destination does not exist (404), so
 * the caller can render a Next.js not-found page. Any other non-OK response is
 * an unexpected failure and throws.
 */
export async function fetchDestination(
  countrySlug: string,
  citySlug: string,
  options: FetchDestinationOptions = {},
): Promise<ApiDestination | null> {
  const params = new URLSearchParams();
  if (options.page !== undefined) params.set("page", String(options.page));
  if (options.pageSize !== undefined) {
    params.set("pageSize", String(options.pageSize));
  }
  const qs = params.toString();
  const url =
    `${API_BASE_URL}/v1/destinations/${encodeURIComponent(countrySlug)}/` +
    `${encodeURIComponent(citySlug)}${qs ? `?${qs}` : ""}`;

  // Read fresh on every request for this slice — no caching of the DB rows.
  const res = await fetch(url, { cache: "no-store" });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `Failed to fetch destination ${countrySlug}/${citySlug}: ${res.status} ${res.statusText}`,
    );
  }

  return (await res.json()) as ApiDestination;
}
