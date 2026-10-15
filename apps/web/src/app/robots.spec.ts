import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { resolveRobots } from "next/dist/build/webpack/loaders/metadata/resolve-route-data";
import robots from "@/app/robots";
import { site } from "@/lib/site";

// A fixture live set (spec 0006 AC-G4). `held-page` is in the manifest but not
// live, so it must not be allowed.
jest.mock("@/content/seo/bangkok/live.generated", () => ({
  LIVE_SLUGS: ["things-to-do", "floating-markets"],
}));

/**
 * robots.ts is `force-dynamic` (it reads the gate password per request), so the
 * build emits no static robots.txt to read. These tests check the function's
 * output instead, which is what `/robots.txt` serves.
 */
const original = process.env.SITE_GATE_PASSWORD;
afterEach(() => {
  if (original === undefined) delete process.env.SITE_GATE_PASSWORD;
  else process.env.SITE_GATE_PASSWORD = original;
});

describe("robots", () => {
  it("while the gate is on, disallows everything except the live slice pages, their sitemap and /_next/", () => {
    process.env.SITE_GATE_PASSWORD = "dummy-gate-password";
    const out = robots();
    expect(out.rules).toEqual({
      userAgent: "*",
      allow: [
        "/destinations/bangkok/things-to-do",
        "/destinations/bangkok/floating-markets",
        "/sitemap-slice.xml",
        "/_next/",
      ],
      disallow: "/",
    });
    expect(out.sitemap).toBe(`${site.url}/sitemap-slice.xml`);
    // /protected/ and /api/canvas/ stay covered by the disallow on "/".
    expect(JSON.stringify(out)).not.toContain("held-page");
    expect(JSON.stringify(out)).not.toContain("/protected/");
  });

  it("with the gate off, blocks /go/, /protected/ and /api/canvas/ but not /tours/", () => {
    delete process.env.SITE_GATE_PASSWORD;
    const out = robots();
    const rule = Array.isArray(out.rules) ? out.rules[0] : out.rules;
    const disallow = ([] as string[]).concat(rule.disallow ?? []);
    expect(disallow).toEqual(expect.arrayContaining(["/go/", "/protected/", "/api/canvas/"]));
    expect(disallow.some((d) => d.startsWith("/tours"))).toBe(false);
    expect(JSON.stringify(out)).not.toContain("/tours/");
    expect(rule.allow).toBe("/");
    expect(out.sitemap).toEqual([`${site.url}/sitemap.xml`, `${site.url}/sitemap-slice.xml`]);
  });

  it("with the gate off, the output is exactly the open rules, with no slice page listed", () => {
    delete process.env.SITE_GATE_PASSWORD;
    // Gate off, the slice pages are reachable under allow "/"; the live set changes nothing here.
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/go/", "/protected/", "/api/canvas/"] },
      sitemap: [`${site.url}/sitemap.xml`, `${site.url}/sitemap-slice.xml`],
      host: site.url,
    });
  });

  it("while the gate is on, renders robots.txt with the allows, then Disallow: /, then the slice sitemap", () => {
    process.env.SITE_GATE_PASSWORD = "dummy-gate-password";
    // resolveRobots is the renderer Next uses to serve /robots.txt from robots.ts.
    expect(resolveRobots(robots())).toBe(
      [
        "User-Agent: *",
        "Allow: /destinations/bangkok/things-to-do",
        "Allow: /destinations/bangkok/floating-markets",
        "Allow: /sitemap-slice.xml",
        "Allow: /_next/",
        "Disallow: /",
        "",
        `Sitemap: ${site.url}/sitemap-slice.xml`,
        "",
      ].join("\n"),
    );
  });
});
