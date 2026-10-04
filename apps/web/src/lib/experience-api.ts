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
 * The page data for one Experience, or `null` when the id is malformed (no
 * fetch is made) or the api answers 404. Any other failure throws: a network
 * error, a 5xx, or a body that no longer matches the shared contract. Throwing
 * lets ISR keep the last good page, and an error is never cached as a 404.
 */
export async function fetchExperiencePage(
  experienceId: string,
  base = API_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<ExperiencePage | null> {
  if (!isExperienceId(experienceId)) return null;
  const res = await fetchImpl(`${base}/v1/experiences/${encodeURIComponent(experienceId)}`, {
    next: { revalidate: 900 },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch experience ${experienceId}: ${res.status} ${res.statusText}`);
  const parsed = experiencePageSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`Unexpected response for experience ${experienceId}: ${parsed.error.message}`);
  return parsed.data;
}
