import { afterEach, describe, expect, it, jest } from "@jest/globals";
import robots from "@/app/robots";
import { site } from "@/lib/site";

// The state before the first approval: nothing is live (spec 0006 AC-G4).
jest.mock("@/content/seo/bangkok/live.generated", () => ({ LIVE_SLUGS: [] }));

const original = process.env.SITE_GATE_PASSWORD;
afterEach(() => {
  if (original === undefined) delete process.env.SITE_GATE_PASSWORD;
  else process.env.SITE_GATE_PASSWORD = original;
});

describe("robots with an empty live set", () => {
  it("while the gate is on, allows only the slice sitemap and /_next/, then disallows everything", () => {
    process.env.SITE_GATE_PASSWORD = "dummy-gate-password";
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: ["/sitemap-slice.xml", "/_next/"], disallow: "/" },
      sitemap: `${site.url}/sitemap-slice.xml`,
    });
  });

  it("while the gate is on, allows no slice page", () => {
    process.env.SITE_GATE_PASSWORD = "dummy-gate-password";
    expect(JSON.stringify(robots())).not.toContain("/destinations/");
  });

  it("with the gate off, is the open rules plus the slice sitemap", () => {
    delete process.env.SITE_GATE_PASSWORD;
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/go/", "/protected/", "/api/canvas/"] },
      sitemap: [`${site.url}/sitemap.xml`, `${site.url}/sitemap-slice.xml`],
      host: site.url,
    });
  });

  it("treats a blank password as the gate being off", () => {
    process.env.SITE_GATE_PASSWORD = "   ";
    expect(robots().rules).toEqual({ userAgent: "*", allow: "/", disallow: ["/go/", "/protected/", "/api/canvas/"] });
  });
});
