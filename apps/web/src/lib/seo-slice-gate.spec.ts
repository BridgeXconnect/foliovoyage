import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { NextRequest } from "next/server";
import { makeIsSlicePath, slicePagePaths } from "@/lib/seo-slice-gate";
import { FIXTURE_LIVE, GATE_CASES } from "@/lib/seo-slice-gate.cases";
import { middleware } from "@/middleware";

// A fixture live set. `held-page` stands for a manifest slug that is not live
// (held, or with copy but no fact check): it is in no live set here.
jest.mock("@/content/seo/bangkok/live.generated", () => ({
  LIVE_SLUGS: ["things-to-do", "floating-markets"],
}));

const LIVE = ["things-to-do", "floating-markets"];

const REJECTED = [
  "/destinations/bangkok",
  "/destinations/bangkok/",
  "/destinations/bangkok/held-page",
  "/destinations/bangkok/unknown",
  "/destinations/bangkok/things-to-do/",
  "/destinations/bangkok/things-to-do/extra",
  "/destinations/bangkok/things-to-dox",
  "/go/other",
  "/go/tours",
  "/sitemap-slice.xml/",
  "/sitemap.xml",
  "/",
];

describe("isSlicePath (spec 0006 AC-G1, AC-G2)", () => {
  const isSlicePath = makeIsSlicePath(LIVE);

  it("passes every live page, the slice sitemap and the two prefixes", () => {
    for (const p of slicePagePaths(LIVE)) expect(isSlicePath(p)).toBe(true);
    expect(isSlicePath("/sitemap-slice.xml")).toBe(true);
    expect(isSlicePath("/go/tours/abc123")).toBe(true);
    expect(isSlicePath("/ingest/e/")).toBe(true);
  });

  it("rejects everything else, matching the full pathname exactly", () => {
    for (const p of REJECTED) expect([p, isSlicePath(p)]).toEqual([p, false]);
  });

  it("with an empty live set opens neither prefix", () => {
    const empty = makeIsSlicePath([]);
    expect(slicePagePaths([])).toEqual([]);
    expect(empty("/go/tours/abc123")).toBe(false);
    expect(empty("/ingest/decide")).toBe(false);
    for (const slug of LIVE) expect(empty(`/destinations/bangkok/${slug}`)).toBe(false);
  });

  it("the first live slug opens both prefixes", () => {
    const one = makeIsSlicePath(["things-to-do"]);
    expect(one("/destinations/bangkok/things-to-do")).toBe(true);
    expect(one("/go/tours/abc123")).toBe(true);
    expect(one("/ingest/decide")).toBe(true);
    expect(one("/destinations/bangkok/floating-markets")).toBe(false);
  });
});

describe("middleware with the gate on (spec 0006 AC-G1, AC-G2)", () => {
  const original = process.env.SITE_GATE_PASSWORD;
  afterEach(() => {
    if (original === undefined) delete process.env.SITE_GATE_PASSWORD;
    else process.env.SITE_GATE_PASSWORD = original;
  });

  const run = (pathname: string) => {
    process.env.SITE_GATE_PASSWORD = "dummy-gate-password";
    return middleware(new NextRequest(`https://example.test${pathname}`));
  };

  it("lets live slice paths through unchanged", async () => {
    for (const p of [...slicePagePaths(LIVE), "/sitemap-slice.xml", "/go/tours/abc123", "/ingest/e/"]) {
      const res = await run(p);
      expect([p, res.headers.get("x-middleware-rewrite")]).toEqual([p, null]);
      expect(res.headers.get("x-robots-tag")).toBeNull();
    }
  });

  it("rewrites every other path to the coming soon page with noindex", async () => {
    for (const p of REJECTED) {
      const res = await run(p);
      // NextURL keeps a trailing slash on the rewrite target; either is the holding page.
      expect([p, res.headers.get("x-middleware-rewrite")?.replace(/\/$/, "")]).toEqual([
        p,
        "https://example.test/coming-soon",
      ]);
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }
  });
});

describe("edge safety (spec 0006 AC-G3)", () => {
  const read = (rel: string) => readFileSync(path.join(__dirname, rel), "utf8");
  const imports = (src: string) => [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);

  it("the gate imports only the generated slug list", () => {
    expect(imports(read("seo-slice-gate.ts"))).toEqual(["@/content/seo/bangkok/live.generated"]);
  });

  it("the generated slug list imports nothing", () => {
    expect(imports(read("../content/seo/bangkok/live.generated.ts"))).toEqual([]);
  });
});

describe("middleware on tricky paths with a two slug live set (spec 0006 AC-G1, AC-G2)", () => {
  const original = process.env.SITE_GATE_PASSWORD;
  afterEach(() => {
    if (original === undefined) delete process.env.SITE_GATE_PASSWORD;
    else process.env.SITE_GATE_PASSWORD = original;
  });

  it("the mocked live set is the shared fixture", () => {
    expect(LIVE).toEqual(FIXTURE_LIVE);
  });

  // Built from a real URL string, so dot segments resolve the way the runtime resolves them.
  it.each(GATE_CASES)("$raw ($why) resolves to $resolved and passes=$passes", async ({ raw, resolved, passes }) => {
    process.env.SITE_GATE_PASSWORD = "dummy-gate-password";
    const req = new NextRequest(`https://example.test${raw}`);
    expect(req.nextUrl.pathname).toBe(resolved);

    const res = await middleware(req);
    const rewrite = res.headers.get("x-middleware-rewrite")?.replace(/\/$/, "") ?? null;
    if (passes) {
      expect(rewrite).toBeNull();
      expect(res.headers.get("x-robots-tag")).toBeNull();
    } else {
      expect(rewrite).toBe("https://example.test/coming-soon");
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }
  });
});
