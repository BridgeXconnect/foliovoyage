import { describe, expect, it } from "@jest/globals";
import type { Destination, Experience } from "@folio/shared";
import {
  findExperienceDetail,
  listExperienceDetailParams,
  experienceDetailPath,
  experienceGoHref,
  experienceDetailAffiliateInput,
} from "@/lib/experience-detail";
import { getAllDestinations } from "@/data/destinations-helpers";

const baseExperience: Experience = {
  id: "base",
  title: "Base",
  description: "Desc.",
  image: "https://example.test/i.jpg",
  imageAlt: "alt",
  category: "Culture & History",
  priceBand: "$$",
};

const baseDestination: Destination = {
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

describe("findExperienceDetail", () => {
  it("returns the destination + experience for a real slug/id pair", () => {
    const found = findExperienceDetail("bangkok", "grand-palace-wat-phra-kaew");
    expect(found).toBeDefined();
    expect(found!.destination.slug).toBe("bangkok");
    expect(found!.experience.id).toBe("grand-palace-wat-phra-kaew");
    expect(found!.experience.title).toMatch(/Grand Palace/);
  });

  it("returns undefined for an unknown destination slug", () => {
    expect(findExperienceDetail("atlantis", "grand-palace-wat-phra-kaew")).toBeUndefined();
  });

  it("returns undefined for a known slug but unknown experience id", () => {
    expect(findExperienceDetail("bangkok", "no-such-experience")).toBeUndefined();
  });
});

describe("listExperienceDetailParams", () => {
  it("enumerates one param pair per experience across every destination", () => {
    const params = listExperienceDetailParams();
    const expected = getAllDestinations().reduce((n, d) => n + d.experiences.length, 0);
    expect(params.length).toBe(expected);
    // every pair resolves back to a real detail
    for (const p of params) {
      expect(findExperienceDetail(p.slug, p.experienceId)).toBeDefined();
    }
  });

  it("produces unique slug/id pairs", () => {
    const params = listExperienceDetailParams();
    const keys = new Set(params.map((p) => `${p.slug}/${p.experienceId}`));
    expect(keys.size).toBe(params.length);
  });
});

describe("experienceDetailPath", () => {
  it("builds the nested canonical path", () => {
    expect(experienceDetailPath("bangkok", "wat-arun-sunset")).toBe(
      "/destinations/bangkok/experiences/wat-arun-sunset",
    );
  });
});

describe("experienceGoHref", () => {
  it("routes a live experience through /go/:slug/:id (never the raw affiliateUrl)", () => {
    const live = { ...baseExperience, id: "x1", affiliateUrl: "https://www.viator.com/tours/abc" };
    expect(experienceGoHref("bangkok", live)).toBe("/go/bangkok/x1");
  });

  it("returns undefined when there is no affiliate link", () => {
    const notLive = { ...baseExperience, id: "x1", affiliateUrl: undefined };
    expect(experienceGoHref("bangkok", notLive)).toBeUndefined();
  });
});

describe("experienceDetailAffiliateInput", () => {
  it("carries the stable id + destination context + provider signals", () => {
    const input = experienceDetailAffiliateInput(baseDestination, {
      ...baseExperience,
      id: "x1",
      title: "T",
      provider: "Viator",
      category: "Food & Drink",
      priceBand: "$$",
      rating: 4.5,
      freeCancel: true,
    });
    expect(input).toEqual({
      experienceId: "x1",
      title: "T",
      provider: "Viator",
      category: "Food & Drink",
      priceBand: "$$",
      hasRating: true,
      freeCancel: true,
      city: baseDestination.city,
      country: baseDestination.country,
      destinationSlug: baseDestination.slug,
    });
  });

  it("reports hasRating=false and freeCancel=false when those fields are absent", () => {
    const input = experienceDetailAffiliateInput(baseDestination, {
      ...baseExperience,
      id: "x2",
      rating: undefined,
      freeCancel: undefined,
    });
    expect(input.hasRating).toBe(false);
    expect(input.freeCancel).toBe(false);
  });
});
