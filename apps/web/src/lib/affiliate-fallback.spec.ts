import { describe, expect, it } from "@jest/globals";
import {
  extractAccountAffiliateParams,
  buildProviderSearchFallbackUrl,
} from "@/lib/affiliate-fallback";

describe("extractAccountAffiliateParams", () => {
  it("reads pid/mcid from the first entry that has them", () => {
    const links = {
      "bangkok/a": {
        affiliateUrl:
          "https://www.viator.com/tours/Bangkok/x/d1-1P1?mcid=42383&pid=P00309945&medium=api",
      },
    };
    expect(extractAccountAffiliateParams(links)).toEqual({
      pid: "P00309945",
      mcid: "42383",
    });
  });

  it("returns undefined for an empty registry", () => {
    expect(extractAccountAffiliateParams({})).toBeUndefined();
  });

  it("returns undefined when no entry has a parseable pid/mcid", () => {
    const links = { "bangkok/a": { affiliateUrl: "https://www.viator.com/tours/x/d1-1P1" } };
    expect(extractAccountAffiliateParams(links)).toBeUndefined();
  });

  it("skips an entry with no affiliateUrl and finds the next one", () => {
    const links = {
      "bangkok/a": {},
      "bangkok/b": {
        affiliateUrl: "https://www.viator.com/tours/x/d1-1P1?mcid=42383&pid=P00309945",
      },
    };
    expect(extractAccountAffiliateParams(links)).toEqual({
      pid: "P00309945",
      mcid: "42383",
    });
  });
});

describe("buildProviderSearchFallbackUrl", () => {
  it("builds a viator.com search URL carrying the query and account params", () => {
    const url = buildProviderSearchFallbackUrl("Grand Palace Bangkok", {
      pid: "P00309945",
      mcid: "42383",
    });
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("www.viator.com");
    expect(parsed.pathname).toBe("/searchResults/all");
    expect(parsed.searchParams.get("text")).toBe("Grand Palace Bangkok");
    expect(parsed.searchParams.get("pid")).toBe("P00309945");
    expect(parsed.searchParams.get("mcid")).toBe("42383");
    expect(parsed.searchParams.get("medium")).toBe("api");
    expect(parsed.searchParams.get("campaign")).toBe("affiliate-fallback");
  });

  it("omits pid/mcid/medium when no account params are available, but still returns a usable search URL", () => {
    const url = buildProviderSearchFallbackUrl("Grand Palace Bangkok");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("text")).toBe("Grand Palace Bangkok");
    expect(parsed.searchParams.has("pid")).toBe(false);
    expect(parsed.searchParams.has("mcid")).toBe(false);
    expect(parsed.searchParams.get("campaign")).toBe("affiliate-fallback");
  });
});
