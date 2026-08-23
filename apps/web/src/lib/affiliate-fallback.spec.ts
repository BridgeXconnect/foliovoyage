import { describe, expect, it, afterEach } from "@jest/globals";
import type { Destination, Experience } from "@folio/shared";
import { buildFallbackSearchUrl } from "@/lib/affiliate-fallback";

const experience: Experience = {
  id: "grand-palace-wat-phra-kaew",
  title: "Grand Palace & Wat Phra Kaew Tour",
  description: "d",
  image: "https://example.test/i.jpg",
  imageAlt: "alt",
  category: "Culture & History",
  priceBand: "$$",
};

const destination: Destination = {
  slug: "bangkok",
  city: "Bangkok",
  country: "Thailand",
  tagline: "t",
  heroImage: "https://example.test/h.jpg",
  heroImageAlt: "h",
  intro: ["p"],
  knownFor: ["k"],
  bestTime: "Nov–Feb",
  fromPrice: 100,
  experiences: [],
  lat: 13.75,
  lng: 100.5,
};

describe("buildFallbackSearchUrl", () => {
  afterEach(() => {
    delete process.env.VIATOR_AFFILIATE_PID;
    delete process.env.VIATOR_AFFILIATE_MCID;
  });

  it("builds a viator.com search-results URL", () => {
    const url = new URL(buildFallbackSearchUrl(experience, destination));
    expect(url.hostname).toBe("www.viator.com");
    expect(url.pathname).toBe("/searchResults/all");
  });

  it("includes the experience title and destination city in the search text", () => {
    const url = new URL(buildFallbackSearchUrl(experience, destination));
    const text = url.searchParams.get("text");
    expect(text).toContain("Grand Palace & Wat Phra Kaew Tour");
    expect(text).toContain("Bangkok");
  });

  it("carries the account's pid/mcid so fallback clicks stay attributable", () => {
    const url = new URL(buildFallbackSearchUrl(experience, destination));
    expect(url.searchParams.get("pid")).toBe("P00309945");
    expect(url.searchParams.get("mcid")).toBe("42383");
  });

  it("tags the campaign so fallback traffic is distinguishable in reporting", () => {
    const url = new URL(buildFallbackSearchUrl(experience, destination));
    expect(url.searchParams.get("campaign")).toBe("fallback-bangkok");
  });

  it("honors VIATOR_AFFILIATE_PID / VIATOR_AFFILIATE_MCID env overrides", () => {
    process.env.VIATOR_AFFILIATE_PID = "P00000001";
    process.env.VIATOR_AFFILIATE_MCID = "99999";
    const url = new URL(buildFallbackSearchUrl(experience, destination));
    expect(url.searchParams.get("pid")).toBe("P00000001");
    expect(url.searchParams.get("mcid")).toBe("99999");
  });
});
