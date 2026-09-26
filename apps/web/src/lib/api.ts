/**
 * Tiny server-side client for the Folio Voyage API (ST-5 / BRI-100, extended for
 * ST-11 / BRI-164).
 *
 * Destination data is read server-side from the NestJS API (which reads
 * Postgres) — never hardcoded in the frontend. For an imported city this returns
 * the DB's published Experiences (with their linked Tour's image + price),
 * paginated.
 */

import {
  destinationResponseSchema,
  type DestinationResponse,
  type ExperienceResponse,
  type PaginationMeta,
} from "@folio/shared";

/** Base URL of the API. Server-side only; defaults to the local dev port. */
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

export type { PriceBand } from "@folio/shared";

/**
 * The API's wire contract lives in `@folio/shared` (BRI-214) and is enforced at
 * runtime in {@link fetchDestination}. These aliases keep the names the
 * components already use.
 */
export type ApiExperience = ExperienceResponse;
export type ApiPagination = PaginationMeta;
export type ApiDestination = DestinationResponse;

/** One line per schema issue, `path: message`, for a readable error. */
function summarizeIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string {
  return issues
    .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("; ");
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

  const parsed = destinationResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    // The API answered 200 with a body that no longer matches the shared
    // contract. Fail loudly rather than render from a shape we half-guess.
    throw new Error(
      `Unexpected response for destination ${countrySlug}/${citySlug}: ${summarizeIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}
