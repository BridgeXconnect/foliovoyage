import { afterEach, describe, expect, it } from "@jest/globals";
import robots from "@/app/robots";

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
  it("disallows everything while the gate is on, which covers /protected/ and /api/canvas/", () => {
    process.env.SITE_GATE_PASSWORD = "dummy-gate-password";
    const out = robots();
    expect(out.rules).toEqual({ userAgent: "*", disallow: "/" });
    expect(out.sitemap).toBeUndefined();
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
  });
});
