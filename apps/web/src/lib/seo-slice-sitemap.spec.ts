import { describe, expect, it } from "@jest/globals";
import { GET } from "@/app/sitemap-slice.xml/route";
import { renderSliceSitemap, sliceSitemapEntries } from "@/lib/seo-slice-sitemap";
import type { SeoSliceGeneratedPage, SeoSliceGeneratedPages } from "@/lib/seo-slice/types";
import { site } from "@/lib/site";

const page = (slug: string, computedOn: string): SeoSliceGeneratedPage => ({
  slug,
  snapshot: { computedOn } as SeoSliceGeneratedPage["snapshot"],
  copy: null,
  notes: null,
});

// `held-page` has files (so it is in SLICE_PAGES) but is not in the live set:
// it must never reach the sitemap.
const PAGES: SeoSliceGeneratedPages = {
  "things-to-do": page("things-to-do", "2026-10-10"),
  "floating-markets": page("floating-markets", "2026-10-11"),
  "held-page": page("held-page", "2026-10-12"),
};
const LIVE = ["things-to-do", "floating-markets"];

describe("slice sitemap (spec 0006 AC-G5, AC-G6)", () => {
  it("lists every live page once and nothing else, with its snapshot date", () => {
    const entries = sliceSitemapEntries(LIVE, PAGES);
    const urls = entries.map((e) => e.url);
    const expected = LIVE.map((s) => `${site.url}/destinations/bangkok/${s}`);
    expect(urls).toEqual(expected);
    expect(new Set(urls).size).toBe(urls.length);
    expect(entries.map((e) => e.lastModified)).toEqual(["2026-10-10", "2026-10-11"]);
    expect(JSON.stringify(entries)).not.toContain("held-page");
  });

  it("renders the entries as a urlset", () => {
    const xml = renderSliceSitemap(sliceSitemapEntries(LIVE, PAGES));
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(LIVE.map((s) => `${site.url}/destinations/bangkok/${s}`));
    expect(xml).toContain("<lastmod>2026-10-11</lastmod>");
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  });

  it("fails loudly when a live page has no snapshot", () => {
    expect(() => sliceSitemapEntries(["things-to-do"], {})).toThrow(/no snapshot/);
  });

  it("the route serves exactly the generated live set (empty today)", async () => {
    const { LIVE_SLUGS } = await import("@/content/seo/bangkok/live.generated");
    const res = GET();
    expect(res.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(LIVE_SLUGS.map((s) => `${site.url}/destinations/bangkok/${s}`));
  });
});
