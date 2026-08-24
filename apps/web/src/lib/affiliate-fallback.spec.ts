import { describe, expect, it } from "@jest/globals";
import {
  extractAccountAffiliateParams,
  extractDestinationPageParams,
  buildAccountRootFallbackUrl,
  buildProviderFallbackUrl,
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

describe("extractDestinationPageParams", () => {
  const links = {
    "bangkok/grand-palace": {
      affiliateUrl:
        "https://www.viator.com/tours/Bangkok/One-Day-Bangkok-Everything-In/d343-66102P2?mcid=42383&pid=P00309945&medium=api",
    },
    "bangkok/wat-pho": {
      affiliateUrl: "https://www.viator.com/tours/Bangkok/Wat-Pho/d343-12345P1?mcid=42383&pid=P00309945&medium=api",
    },
    "rome/colosseum": {
      affiliateUrl: "https://www.viator.com/tours/Rome/Colosseum/d511-9999P1?mcid=42383&pid=P00309945&medium=api",
    },
    "lisbon/no-match": { affiliateUrl: "https://www.viator.com/not-a-tour-url" },
  };

  it("derives the city slug + destination ID from a matched product for the given destination", () => {
    expect(extractDestinationPageParams(links, "bangkok")).toEqual({
      citySlug: "Bangkok",
      destinationId: "343",
    });
  });

  it("only matches entries whose key is prefixed with the given destination slug", () => {
    expect(extractDestinationPageParams(links, "rome")).toEqual({
      citySlug: "Rome",
      destinationId: "511",
    });
  });

  it("returns undefined when the destination has no matched products", () => {
    expect(extractDestinationPageParams(links, "kyoto")).toBeUndefined();
  });

  it("returns undefined when the destination's only entries don't parse as productUrls", () => {
    expect(extractDestinationPageParams(links, "lisbon")).toBeUndefined();
  });

  it("returns undefined for an empty registry", () => {
    expect(extractDestinationPageParams({}, "bangkok")).toBeUndefined();
  });
});

describe("buildAccountRootFallbackUrl", () => {
  it("builds Viator's documented bare account-root URL with medium=link", () => {
    const url = buildAccountRootFallbackUrl({ pid: "P00309945", mcid: "42383" });
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("www.viator.com");
    expect(parsed.pathname).toBe("/");
    expect(parsed.searchParams.get("pid")).toBe("P00309945");
    expect(parsed.searchParams.get("mcid")).toBe("42383");
    expect(parsed.searchParams.get("medium")).toBe("link");
    expect(parsed.searchParams.get("campaign")).toBe("affiliate-fallback");
  });

  it("omits pid/mcid/medium when no account params are available", () => {
    const url = buildAccountRootFallbackUrl();
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("www.viator.com");
    expect(parsed.searchParams.has("pid")).toBe(false);
    expect(parsed.searchParams.has("mcid")).toBe(false);
    expect(parsed.searchParams.has("medium")).toBe(false);
    expect(parsed.searchParams.get("campaign")).toBe("affiliate-fallback");
  });
});

describe("buildProviderFallbackUrl", () => {
  const links = {
    "bangkok/grand-palace": {
      affiliateUrl:
        "https://www.viator.com/tours/Bangkok/One-Day-Bangkok-Everything-In/d343-66102P2?mcid=42383&pid=P00309945&medium=api",
    },
  };
  const account = { pid: "P00309945", mcid: "42383" };

  it("builds a destination-page URL (/<City>/d<id>-ttd) when a destination ID can be derived", () => {
    const url = buildProviderFallbackUrl("bangkok", links, account);
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("www.viator.com");
    expect(parsed.pathname).toBe("/Bangkok/d343-ttd");
    expect(parsed.searchParams.get("pid")).toBe("P00309945");
    expect(parsed.searchParams.get("mcid")).toBe("42383");
    expect(parsed.searchParams.get("medium")).toBe("link");
    expect(parsed.searchParams.get("campaign")).toBe("affiliate-fallback");
  });

  it("never uses medium=api on a fallback URL", () => {
    const url = buildProviderFallbackUrl("bangkok", links, account);
    expect(new URL(url).searchParams.get("medium")).not.toBe("api");
  });

  it("falls through to the account-root URL when no destination ID can be derived", () => {
    const url = buildProviderFallbackUrl("kyoto", links, account);
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("www.viator.com");
    expect(parsed.pathname).toBe("/");
    expect(parsed.searchParams.get("pid")).toBe("P00309945");
    expect(parsed.searchParams.get("medium")).toBe("link");
    expect(parsed.searchParams.get("campaign")).toBe("affiliate-fallback");
  });

  it("falls through to the bare account-root URL when neither a destination ID nor account params are available", () => {
    const url = buildProviderFallbackUrl("kyoto", {}, undefined);
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("www.viator.com");
    expect(parsed.searchParams.has("pid")).toBe(false);
    expect(parsed.searchParams.get("campaign")).toBe("affiliate-fallback");
  });
});
