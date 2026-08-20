import { describe, expect, it } from "@jest/globals";
import type { Destination, Experience } from "@folio/shared";
import {
  buildExperienceMetadata,
  buildExperienceProductLd,
  buildExperienceBreadcrumbLd,
} from "@/lib/experience-detail-seo";

const SITE = "https://www.foliovoyage.com";

const dest: Destination = {
  slug: "bangkok", city: "Bangkok", country: "Thailand", tagline: "t",
  heroImage: "https://e.test/h.jpg", heroImageAlt: "h", intro: ["p"],
  knownFor: ["k"], bestTime: "Nov–Feb", fromPrice: 100, experiences: [], lat: 13.75, lng: 100.5,
};

const rich: Experience = {
  id: "wat-arun-sunset", title: "Wat Arun at golden hour", description: "The Temple of Dawn.",
  image: "https://e.test/wat-arun.jpg", imageAlt: "Wat Arun", category: "Landmarks",
  priceBand: "$$", duration: "2–3 hours", provider: "Viator",
  fromPrice: 28, currency: "USD", rating: 4.7, ratingCount: 1200, freeCancel: true,
  affiliateUrl: "https://www.viator.com/tours/abc",
};

const sparse: Experience = {
  id: "wat-pho-reclining-buddha", title: "Wat Pho", description: "Reclining Buddha.",
  image: "https://e.test/wat-pho.jpg", imageAlt: "Wat Pho", category: "Culture & History",
  priceBand: "$",
};

describe("buildExperienceMetadata", () => {
  it("sets a descriptive title and the nested canonical URL", () => {
    const m = buildExperienceMetadata(SITE, dest, rich);
    expect(m.title).toContain("Wat Arun at golden hour");
    expect(m.title).toContain("Bangkok");
    expect(m.alternates?.canonical).toBe("/destinations/bangkok/experiences/wat-arun-sunset");
    expect((m.openGraph as { url?: string }).url).toBe(
      `${SITE}/destinations/bangkok/experiences/wat-arun-sunset`,
    );
    expect((m.openGraph as { images?: { url: string }[] }).images?.[0].url).toBe(rich.image);
  });
});

describe("buildExperienceProductLd", () => {
  it("emits Product with aggregateRating + offers for a rich experience", () => {
    const ld = buildExperienceProductLd(SITE, dest, rich) as Record<string, unknown>;
    expect(ld["@type"]).toBe("Product");
    expect(ld.name).toBe(rich.title);
    expect(ld.aggregateRating).toEqual({
      "@type": "AggregateRating", ratingValue: 4.7, reviewCount: 1200,
    });
    expect(ld.offers).toMatchObject({
      "@type": "Offer", price: "28", priceCurrency: "USD",
      url: `${SITE}/destinations/bangkok/experiences/wat-arun-sunset`,
      seller: { "@type": "Organization", name: "Viator" },
    });
  });

  it("omits aggregateRating and offers-price when those fields are absent", () => {
    const ld = buildExperienceProductLd(SITE, dest, sparse) as Record<string, unknown>;
    expect(ld["@type"]).toBe("Product");
    expect(ld.aggregateRating).toBeUndefined();
    // no fromPrice → no priced Offer (no fabricated price)
    expect((ld.offers as { price?: string; seller?: unknown } | undefined)?.price).toBeUndefined();
    expect((ld.offers as { price?: string; seller?: unknown } | undefined)?.seller).toBeUndefined();
  });
});

describe("buildExperienceBreadcrumbLd", () => {
  it("chains Home → Destinations → City → Experience", () => {
    const ld = buildExperienceBreadcrumbLd(SITE, dest, rich) as Record<string, unknown>;
    expect(ld["@type"]).toBe("BreadcrumbList");
    const items = ld.itemListElement as { position: number; name: string; item: string }[];
    expect(items.map((i) => i.name)).toEqual(["Home", "Destinations", "Bangkok", rich.title]);
    expect(items[2].item).toBe(`${SITE}/destinations/bangkok`);
    expect(items[3].item).toBe(`${SITE}/destinations/bangkok/experiences/wat-arun-sunset`);
  });
});
