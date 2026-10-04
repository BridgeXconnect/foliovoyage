import { proxyTourRating } from "@/lib/tour-rating";

/**
 * GET /protected/tours/:experienceId/rating.json — the rating for a tour page,
 * fetched in the browser by `/protected/tour-rating.js` (spec 0005, AC-6).
 * Blocked in robots.txt; the logic lives in `src/lib/tour-rating.ts`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ experienceId: string }> },
): Promise<Response> {
  const { experienceId } = await params;
  return proxyTourRating(experienceId);
}
