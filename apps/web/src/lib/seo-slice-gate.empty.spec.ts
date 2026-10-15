import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { NextRequest } from "next/server";
import { GATE_CASES } from "@/lib/seo-slice-gate.cases";
import { middleware } from "@/middleware";

// The state before the first approval: nothing is live.
jest.mock("@/content/seo/bangkok/live.generated", () => ({ LIVE_SLUGS: [] }));

describe("middleware with the gate on and an empty live set (spec 0006 AC-G1)", () => {
  const original = process.env.SITE_GATE_PASSWORD;
  afterEach(() => {
    if (original === undefined) delete process.env.SITE_GATE_PASSWORD;
    else process.env.SITE_GATE_PASSWORD = original;
  });

  it("rewrites /go/tours/ and /ingest/ to the coming soon page", async () => {
    process.env.SITE_GATE_PASSWORD = "dummy-gate-password";
    for (const p of ["/go/tours/abc123", "/ingest/e/", "/destinations/bangkok/things-to-do"]) {
      const res = await middleware(new NextRequest(`https://example.test${p}`));
      expect([p, res.headers.get("x-middleware-rewrite")?.replace(/\/$/, "")]).toEqual([
        p,
        "https://example.test/coming-soon",
      ]);
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }
  });
});

describe("middleware on tricky paths with an empty live set (spec 0006 AC-G1)", () => {
  const original = process.env.SITE_GATE_PASSWORD;
  afterEach(() => {
    if (original === undefined) delete process.env.SITE_GATE_PASSWORD;
    else process.env.SITE_GATE_PASSWORD = original;
  });

  // Every case is gated here, including the ones that pass once a page is live.
  it.each(GATE_CASES)("$raw ($why) is gated", async ({ raw, resolved }) => {
    process.env.SITE_GATE_PASSWORD = "dummy-gate-password";
    const req = new NextRequest(`https://example.test${raw}`);
    expect(req.nextUrl.pathname).toBe(resolved);

    const res = await middleware(req);
    expect(res.headers.get("x-middleware-rewrite")?.replace(/\/$/, "")).toBe("https://example.test/coming-soon");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("still lets the slice sitemap through, so it can serve its empty urlset", async () => {
    process.env.SITE_GATE_PASSWORD = "dummy-gate-password";
    const res = await middleware(new NextRequest("https://example.test/sitemap-slice.xml"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
