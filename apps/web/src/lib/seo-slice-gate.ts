/**
 * The SEO slice allowlist through the coming soon gate (spec 0006 AC-G1 to
 * AC-G3). While the gate is on, anonymous visitors and crawlers reach only the
 * live slice pages, the slice sitemap, click outs (`/go/tours/`) and the
 * analytics proxy (`/ingest/`). The two prefixes open only once at least one
 * page is live, so an empty live set exposes no click out or analytics path.
 * Matching is exact on the pathname: no trailing
 * slash, no extra segment, and `/destinations/bangkok` itself stays gated.
 *
 * Edge safe: it imports only the generated slug list, never `fs`.
 */

import { LIVE_SLUGS } from "@/content/seo/bangkok/live.generated";

export const SLICE_PAGE_PREFIX = "/destinations/bangkok/";
export const SLICE_SITEMAP_PATH = "/sitemap-slice.xml";
const PASS_PREFIXES = ["/go/tours/", "/ingest/"];

/** The public paths of the live slice pages, in manifest order. */
export function slicePagePaths(liveSlugs: readonly string[] = LIVE_SLUGS): string[] {
  return liveSlugs.map((slug) => `${SLICE_PAGE_PREFIX}${slug}`);
}

/** Builds the check for a given live set; the middleware uses the generated one. */
export function makeIsSlicePath(liveSlugs: readonly string[]): (pathname: string) => boolean {
  const exact = new Set([...slicePagePaths(liveSlugs), SLICE_SITEMAP_PATH]);
  const prefixes = liveSlugs.length > 0 ? PASS_PREFIXES : [];
  return (pathname) => exact.has(pathname) || prefixes.some((p) => pathname.startsWith(p));
}

export const isSlicePath = makeIsSlicePath(LIVE_SLUGS);
