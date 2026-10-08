import { describe, expect, it } from "@jest/globals";
import sitemap from "@/app/sitemap";
import { getAllDestinations } from "@/data/destinations-helpers";
import { site } from "@/lib/site";

describe("sitemap", () => {
  it("includes a detail URL for every experience in every destination", () => {
    const urls = new Set(sitemap().map((r) => r.url));
    for (const d of getAllDestinations()) {
      for (const e of d.experiences) {
        expect(urls.has(`${site.url}/destinations/${d.slug}/experiences/${e.id}`)).toBe(
          true,
        );
      }
    }
  });

  it("still lists the canonical destination pages", () => {
    const urls = new Set(sitemap().map((r) => r.url));
    for (const d of getAllDestinations()) {
      expect(urls.has(`${site.url}/destinations/${d.slug}`)).toBe(true);
    }
  });

  it("lists /guides and no longer lists /blog", () => {
    const urls = new Set(sitemap().map((r) => r.url));
    expect(urls.has(`${site.url}/guides`)).toBe(true);
    for (const u of urls) expect(u.startsWith(`${site.url}/blog`)).toBe(false);
  });

  it("lists the /search page", () => {
    const urls = new Set(sitemap().map((r) => r.url));
    expect(urls.has(`${site.url}/search`)).toBe(true);
  });

  // Spec 0005: the tour pages are noindex until the AI copy passes its
  // evaluation. Listing them is a separate, later change. `/discover` went with
  // the canvas view (BRI-245) and must not be listed either.
  it("lists no /tours/ page and no /discover page", () => {
    for (const { url } of sitemap()) {
      expect(url).not.toContain("/tours/");
      expect(url).not.toContain("/discover");
    }
  });
});
