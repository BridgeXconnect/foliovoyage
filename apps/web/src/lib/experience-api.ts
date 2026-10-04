/**
 * Server side access to the tour page data (spec 0005, AC-4, AC-8, AC-15).
 *
 * Used by the `/tours/:experienceId` page, its `generateMetadata`, and the
 * `/go/tours/:experienceId` redirect. All three make the identical fetch
 * (same URL, same `revalidate`), so Next dedupes it within a render and the
 * redirect shares the page's 15 minute cache. `API_BASE_URL` is server only.
 */

import { experiencePageSchema, type ExperiencePage } from "@folio/shared";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

/** Every production Experience id is a 25 character cuid; the bounds leave room. */
const EXPERIENCE_ID = /^c[a-z0-9]{20,32}$/;

export const isExperienceId = (id: string): boolean => EXPERIENCE_ID.test(id);

/**
 * Why a tour page is "no longer available". The api tells its three 404 cases
 * apart in the problem+json `detail`; a failed id check is `malformed`. This is
 * only ever logged (`event=tour_page_not_found reason=...`), never sent to
 * PostHog, and carries no free text.
 */
export type NotFoundReason = "unknown" | "unpublished" | "removed" | "malformed";

export type ExperiencePageResult =
  | { found: true; page: ExperiencePage }
  | { found: false; reason: NotFoundReason };

/**
 * Maps the api's 404 `detail` to a reason. The strings mirror `NOT_FOUND_DETAIL`
 * in `apps/api/src/experiences/experiences.service.ts`; anything unrecognised
 * (or a body that is not JSON) is `unknown`.
 */
export function notFoundReason(detail: unknown): NotFoundReason {
  const text = typeof detail === "string" ? detail.toLowerCase() : "";
  if (text.includes("not published")) return "unpublished";
  if (text.includes("no live tour")) return "removed";
  return "unknown";
}

/**
 * The page data for one Experience, or the reason it is not available. A
 * malformed id makes no fetch. Only a definitive api 404 is `found: false`; any
 * other failure throws (a network error, a 5xx, or a body that no longer
 * matches the shared contract), so ISR keeps the last good page and an error is
 * never cached as a 404.
 */
export async function fetchExperiencePageResult(
  experienceId: string,
  base = API_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<ExperiencePageResult> {
  if (!isExperienceId(experienceId)) return { found: false, reason: "malformed" };
  const res = await fetchImpl(`${base}/v1/experiences/${encodeURIComponent(experienceId)}`, {
    next: { revalidate: 900 },
  });
  if (res.status === 404) {
    const body: unknown = await res.json().catch(() => null);
    const detail = body && typeof body === "object" ? (body as { detail?: unknown }).detail : undefined;
    return { found: false, reason: notFoundReason(detail) };
  }
  if (!res.ok) throw new Error(`Failed to fetch experience ${experienceId}: ${res.status} ${res.statusText}`);
  const parsed = experiencePageSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`Unexpected response for experience ${experienceId}: ${parsed.error.message}`);
  return { found: true, page: parsed.data };
}

/** The page data, or `null` when it is not available (the reason is dropped). */
export async function fetchExperiencePage(
  experienceId: string,
  base = API_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<ExperiencePage | null> {
  const result = await fetchExperiencePageResult(experienceId, base, fetchImpl);
  return result.found ? result.page : null;
}
