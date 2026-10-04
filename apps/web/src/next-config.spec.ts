import { describe, expect, it } from "@jest/globals";
import nextConfig from "../next.config";

describe("next.config headers", () => {
  it("serves the rating script as JavaScript with the shared cache window and noindex", async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.source === "/protected/tour-rating.js");
    const h = Object.fromEntries(rule!.headers.map((x) => [x.key, x.value]));
    expect(h["Content-Type"]).toMatch(/^application\/javascript/);
    expect(h["Cache-Control"]).toBe("public, s-maxage=900, stale-while-revalidate=86400");
    expect(h["X-Robots-Tag"]).toBe("noindex");
  });
});
