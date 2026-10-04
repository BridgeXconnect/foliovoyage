/**
 * `GET /protected/tours/:experienceId/rating.json` logic (spec 0005, AC-2,
 * AC-6). The rating is protected content under Viator's rules, so it only
 * travels on this robots blocked route and never in the page. The route file
 * stays a thin wrapper because a Next route file may only export handlers.
 */

import { experienceRatingSchema } from "@folio/shared";
import { isExperienceId } from "@/lib/experience-api";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

const CACHED = "public, s-maxage=900, stale-while-revalidate=86400";
const UNCACHED = "no-store";

function respond(status: number, body: unknown, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": status === 200 ? "application/json" : "application/problem+json",
      "cache-control": cacheControl,
      "x-robots-tag": "noindex",
    },
  });
}

const problem = (status: number, title: string, detail: string, cacheControl: string) =>
  respond(status, { type: "about:blank", title, status, detail }, cacheControl);

/**
 * Proxy the rating from the api and return only `{ratingAvg, ratingCount}`.
 * A malformed id is a 404 without a fetch. An api 404 is a 404 (cached like
 * the api's own). A network error, a 5xx, or a body that no longer matches the
 * shared contract is a 502 that is never cached, so an outage is not frozen in.
 */
export async function proxyTourRating(
  experienceId: string,
  base = API_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!isExperienceId(experienceId)) {
    return problem(404, "Not Found", "Unknown tour.", UNCACHED);
  }
  try {
    const res = await fetchImpl(`${base}/v1/experiences/${encodeURIComponent(experienceId)}/rating`, {
      next: { revalidate: 900 },
    });
    if (res.status === 404) return problem(404, "Not Found", "Unknown tour.", CACHED);
    if (!res.ok) throw new Error(`api answered ${res.status}`);
    const parsed = experienceRatingSchema.parse(await res.json());
    return respond(200, { ratingAvg: parsed.ratingAvg, ratingCount: parsed.ratingCount }, CACHED);
  } catch (err) {
    console.error(`Rating proxy failed for ${experienceId}:`, err);
    return problem(502, "Bad Gateway", "The rating is unavailable.", UNCACHED);
  }
}
