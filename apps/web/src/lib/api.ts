/**
 * Tiny server-side client for the Folio Voyage API (ST-5 / BRI-100).
 *
 * The first vertical slice reads a single seeded destination from the NestJS
 * API (which reads Postgres) — data flows browser → web server component →
 * API → DB, never hardcoded in the frontend.
 */

/** Base URL of the API. Server-side only; defaults to the local dev port. */
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

export interface ApiExperience {
  id: string;
  title: string;
  description: string;
}

export interface ApiDestination {
  city: string;
  citySlug: string;
  country: string;
  countrySlug: string;
  heroImageUrl: string;
  heroImageAlt: string;
  experiences: ApiExperience[];
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
): Promise<ApiDestination | null> {
  const url = `${API_BASE_URL}/v1/destinations/${encodeURIComponent(
    countrySlug,
  )}/${encodeURIComponent(citySlug)}`;

  // Read fresh on every request for this slice — no caching of the seeded row.
  const res = await fetch(url, { cache: "no-store" });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `Failed to fetch destination ${countrySlug}/${citySlug}: ${res.status} ${res.statusText}`,
    );
  }

  return (await res.json()) as ApiDestination;
}
