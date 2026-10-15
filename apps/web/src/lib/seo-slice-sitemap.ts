/**
 * `/sitemap-slice.xml` (spec 0006 AC-G5): exactly the live slice pages, each
 * an absolute URL on `site.url` with `lastModified` from its snapshot's
 * `computedOn`. Slugs come from `LIVE_SLUGS` only, never from the keys of
 * `SLICE_PAGES` (which also holds pages that are not live).
 */

import { LIVE_SLUGS } from "@/content/seo/bangkok/live.generated";
import { SLICE_PAGES } from "@/content/seo/bangkok/pages.generated";
import { slicePagePaths } from "@/lib/seo-slice-gate";
import type { SeoSliceGeneratedPages } from "@/lib/seo-slice/types";
import { site } from "@/lib/site";

export interface SliceSitemapEntry {
  url: string;
  lastModified: string;
}

export function sliceSitemapEntries(
  liveSlugs: readonly string[] = LIVE_SLUGS,
  pages: SeoSliceGeneratedPages = SLICE_PAGES,
): SliceSitemapEntry[] {
  const paths = slicePagePaths(liveSlugs);
  return liveSlugs.map((slug, i) => {
    const computedOn = pages[slug]?.snapshot?.computedOn;
    // A live page always has a snapshot (AC-2); a missing one means the
    // generated files are out of step, so fail the build rather than guess.
    if (!computedOn) throw new Error(`live slice page ${slug} has no snapshot computedOn`);
    return { url: `${site.url}${paths[i]}`, lastModified: computedOn };
  });
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderSliceSitemap(entries: SliceSitemapEntry[]): string {
  const urls = entries
    .map((e) => `  <url>\n    <loc>${escapeXml(e.url)}</loc>\n    <lastmod>${escapeXml(e.lastModified)}</lastmod>\n  </url>\n`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>\n`;
}
