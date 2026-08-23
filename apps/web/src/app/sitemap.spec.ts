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
});
