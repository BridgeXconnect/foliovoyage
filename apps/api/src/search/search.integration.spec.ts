import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

import { CURATED_CITIES } from "../modules/import/curated-cities";
import type { PrismaService } from "../prisma/prisma.service";
import { SearchService } from "./search.service";

/**
 * Integration tests for {@link SearchService} against a **real Postgres**
 * (ST-13 / BRI-125). Unit tests (search.service.spec.ts) cover the pure
 * ranking/merge logic with fakes; these are the tests the story's AC actually
 * needs *run*: real `tsvector`/`ts_rank_cd`/GIN-index behaviour, real trigger
 * sync, and real query latency — none of which a mock can stand in for.
 *
 * Seeded at a **meaningful sample size** (5,000 filler Experiences across the
 * 6 curated cities, not a handful of rows) so index usage, ranking, and the
 * <500ms budget (docs/03 ST-13 AC) are exercised close to the real ~26K-product
 * catalogue scale, not a toy dataset that would pass trivially with a full
 * table scan.
 *
 * Fixtures are scoped by a dedicated `sourceProvider: "search-test"` so they
 * never touch the `viator` rows other integration specs manage. Curated City
 * rows are reset from the registry in `afterAll`, mirroring
 * experience-linker.integration.spec.ts's convention.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

const PROVIDER = "search-test";
const FILLER_COUNT = 5000;
const FILLER_TOPICS = [
  "walking",
  "cycling",
  "museum",
  "market",
  "sunset",
  "cooking class",
  "day trip",
  "boat",
  "hiking",
  "photography",
];

let cityIdBySlug: Record<string, string> = {};

function service(): SearchService {
  return new SearchService(prisma as unknown as PrismaService);
}

/** Upsert every curated City from the registry, restoring known-good fields. */
async function seedCuratedCities(): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const c of CURATED_CITIES) {
    const city = await prisma.city.upsert({
      where: { countrySlug_slug: { countrySlug: c.countrySlug, slug: c.slug } },
      update: {
        name: c.name,
        country: c.country,
        viatorDestRef: c.primaryRef,
        centroidLat: c.centroidLat,
        centroidLng: c.centroidLng,
        heroImageUrl: c.heroImageUrl,
        heroImageAlt: c.heroImageAlt,
      },
      create: {
        slug: c.slug,
        countrySlug: c.countrySlug,
        name: c.name,
        country: c.country,
        viatorDestRef: c.primaryRef,
        centroidLat: c.centroidLat,
        centroidLng: c.centroidLng,
        heroImageUrl: c.heroImageUrl,
        heroImageAlt: c.heroImageAlt,
      },
      select: { id: true, slug: true },
    });
    ids[c.slug] = city.id;
  }
  return ids;
}

async function cleanup(): Promise<void> {
  await prisma.tour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.affiliateClick.deleteMany({ where: { providerId: PROVIDER } });
  await prisma.experience.deleteMany({ where: { sourceProvider: PROVIDER } });
}

beforeAll(async () => {
  await cleanup();
  cityIdBySlug = await seedCuratedCities();

  // 5,000 filler rows spread across the 6 curated cities, distinct enough in
  // wording that none of them accidentally match the "needle" queries the
  // correctness tests below search for.
  const fillerData = Array.from({ length: FILLER_COUNT }, (_, i) => {
    const city = CURATED_CITIES[i % CURATED_CITIES.length];
    const topic = FILLER_TOPICS[i % FILLER_TOPICS.length];
    return {
      title: `${topic} experience number ${i}`,
      description: `A generic ${topic} activity for visitors passing through, item ${i}.`,
      status: "published",
      latitude: city.centroidLat,
      longitude: city.centroidLng,
      cityId: cityIdBySlug[city.slug],
      position: i,
      sourceProvider: PROVIDER,
      sourceProviderTourId: `filler-${i}`,
    };
  });
  // Batch in chunks — a single 5,000-row createMany is fine for Postgres, but
  // chunking keeps this robust if the driver caps statement/parameter size.
  const CHUNK = 1000;
  for (let i = 0; i < fillerData.length; i += CHUNK) {
    await prisma.experience.createMany({ data: fillerData.slice(i, i + CHUNK) });
  }
}, 60000);

afterAll(async () => {
  await cleanup();
  for (const c of CURATED_CITIES) {
    await prisma.city.update({
      where: { countrySlug_slug: { countrySlug: c.countrySlug, slug: c.slug } },
      data: { name: c.name, country: c.country },
    });
  }
  await prisma.$disconnect();
});

describe("SearchService against a realistic-scale catalogue", () => {
  it("finds a needle experience by an exact title term among 5,000 filler rows", async () => {
    const exp = await prisma.experience.create({
      data: {
        title: "Sunrise Kayak Expedition on the Chao Phraya",
        description: "Paddle past the temples before the city wakes.",
        status: "published",
        latitude: 13.7,
        longitude: 100.5,
        cityId: cityIdBySlug["bangkok"],
        sourceProvider: PROVIDER,
        sourceProviderTourId: "needle-kayak",
      },
    });

    const response = await service().search("kayak");

    expect(response.results.some((r) => r.type === "experience" && r.id === exp.id)).toBe(
      true,
    );
  });

  it("matches on description text alone, not just the title", async () => {
    const exp = await prisma.experience.create({
      data: {
        title: "Countryside Craft Workshop",
        description: "Learn hand-thrown pottery from a third-generation ceramicist.",
        status: "published",
        latitude: 41.9,
        longitude: 12.5,
        cityId: cityIdBySlug["rome"],
        sourceProvider: PROVIDER,
        sourceProviderTourId: "needle-pottery",
      },
    });

    const response = await service().search("hand-thrown pottery");

    expect(response.results.some((r) => r.type === "experience" && r.id === exp.id)).toBe(
      true,
    );
  });

  it("matches an experience via its parent City's name, even when absent from title/description", async () => {
    const exp = await prisma.experience.create({
      data: {
        title: "Matcha Ceremony & Garden Walk",
        description: "A quiet afternoon of tea and stillness.",
        status: "published",
        latitude: 35.0,
        longitude: 135.8,
        cityId: cityIdBySlug["kyoto"],
        sourceProvider: PROVIDER,
        sourceProviderTourId: "needle-kyoto-tea",
      },
    });

    // Neither "Kyoto" nor "Japan" appears in the title/description — only the
    // trigger-populated city-name weight (C) makes this match.
    const response = await service().search("Kyoto tea ceremony");

    expect(response.results.some((r) => r.type === "experience" && r.id === exp.id)).toBe(
      true,
    );
  });

  it("applies AND semantics across query terms (plainto_tsquery), not OR", async () => {
    const onlyTemple = await prisma.experience.create({
      data: {
        title: "Ancient Temple Complex Tour",
        description: "A guided walk through centuries-old shrines.",
        status: "published",
        latitude: 13.7,
        longitude: 100.5,
        cityId: cityIdBySlug["bangkok"],
        sourceProvider: PROVIDER,
        sourceProviderTourId: "needle-temple-only",
      },
    });
    const both = await prisma.experience.create({
      data: {
        title: "Temple Complex & Floating Market Combo",
        description: "Shrines in the morning, market stalls in the afternoon.",
        status: "published",
        latitude: 13.7,
        longitude: 100.5,
        cityId: cityIdBySlug["bangkok"],
        sourceProvider: PROVIDER,
        sourceProviderTourId: "needle-temple-market",
      },
    });

    const response = await service().search("temple market");
    const ids = response.results
      .filter((r) => r.type === "experience")
      .map((r) => (r.type === "experience" ? r.id : ""));

    expect(ids).toContain(both.id);
    expect(ids).not.toContain(onlyTemple.id);
  });

  it("applies English stemming — a plural query matches a singular title", async () => {
    const exp = await prisma.experience.create({
      data: {
        title: "Artisan Gelato Tasting Tour",
        description: "Sample small-batch flavors across three historic shops.",
        status: "published",
        latitude: 41.9,
        longitude: 12.5,
        cityId: cityIdBySlug["rome"],
        sourceProvider: PROVIDER,
        sourceProviderTourId: "needle-gelato",
      },
    });

    const response = await service().search("gelato tours"); // plural "tours" ~ "Tour"

    expect(response.results.some((r) => r.type === "experience" && r.id === exp.id)).toBe(
      true,
    );
  });

  it("never returns a draft experience, however strong the text match", async () => {
    const draft = await prisma.experience.create({
      data: {
        title: "Unreviewed Zeppelin Ride Over the Old Town",
        description: "Auto-created, not yet promoted.",
        status: "draft",
        latitude: 38.7,
        longitude: -9.1,
        cityId: cityIdBySlug["lisbon"],
        sourceProvider: PROVIDER,
        sourceProviderTourId: "needle-draft-zeppelin",
      },
    });

    const response = await service().search("zeppelin");

    expect(response.results.some((r) => r.type === "experience" && r.id === draft.id)).toBe(
      false,
    );
  });

  it("ranks a higher editorRating above an otherwise-equal text match", async () => {
    const rated = await prisma.experience.create({
      data: {
        title: "Backstreet Noodle Alley Food Crawl",
        description: "Six stops, six family-run kitchens.",
        status: "published",
        editorRating: 4.9,
        latitude: 21.0,
        longitude: 105.9,
        cityId: cityIdBySlug["hanoi"],
        sourceProvider: PROVIDER,
        sourceProviderTourId: "needle-food-crawl-rated",
      },
    });
    const unrated = await prisma.experience.create({
      data: {
        title: "Backstreet Noodle Alley Food Crawl (Evening)",
        description: "Six stops, six family-run kitchens, after dark.",
        status: "published",
        editorRating: null,
        latitude: 21.0,
        longitude: 105.9,
        cityId: cityIdBySlug["hanoi"],
        sourceProvider: PROVIDER,
        sourceProviderTourId: "needle-food-crawl-unrated",
      },
    });

    const response = await service().search("backstreet noodle alley food crawl");
    const ids = response.results
      .filter((r) => r.type === "experience")
      .map((r) => (r.type === "experience" ? r.id : ""));

    expect(ids.indexOf(rated.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(unrated.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(rated.id)).toBeLessThan(ids.indexOf(unrated.id));
  });

  it("ranks a tour with recorded clicks above an otherwise-equal, unclicked one", async () => {
    const clickedExp = await prisma.experience.create({
      data: {
        title: "Riverside Sunset Sailing Charter",
        description: "A two-hour sail as the sky turns gold.",
        status: "published",
        latitude: 13.7,
        longitude: 100.5,
        cityId: cityIdBySlug["bangkok"],
        sourceProvider: PROVIDER,
        sourceProviderTourId: "needle-sailing-clicked",
      },
    });
    const clickedTour = await prisma.tour.create({
      data: {
        provider: PROVIDER,
        providerTourId: "sailing-clicked-tour",
        title: clickedExp.title,
        experienceId: clickedExp.id,
        fetchedAt: new Date(),
        sourceHash: "h1",
      },
    });
    // Simulate the future DB-backed /go path (AffiliateClick.tourId = Tour.id).
    // At the popularity clamp (50) for a comfortable margin over incidental
    // ts_rank_cd noise from the two titles' differing length.
    await prisma.affiliateClick.createMany({
      data: Array.from({ length: 50 }, () => ({
        tourId: clickedTour.id,
        providerId: PROVIDER,
      })),
    });

    const unclickedExp = await prisma.experience.create({
      data: {
        title: "Riverside Sunset Sailing Charter (Private)",
        description: "A two-hour private sail as the sky turns gold.",
        status: "published",
        latitude: 13.7,
        longitude: 100.5,
        cityId: cityIdBySlug["bangkok"],
        sourceProvider: PROVIDER,
        sourceProviderTourId: "needle-sailing-unclicked",
      },
    });

    const response = await service().search("riverside sunset sailing charter");
    const ids = response.results
      .filter((r) => r.type === "experience")
      .map((r) => (r.type === "experience" ? r.id : ""));

    expect(ids.indexOf(clickedExp.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(unclickedExp.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(clickedExp.id)).toBeLessThan(ids.indexOf(unclickedExp.id));
  });

  it("returns a matching Destination alongside matching Experiences", async () => {
    const response = await service().search("Bangkok");

    expect(
      response.results.some((r) => r.type === "destination" && r.citySlug === "bangkok"),
    ).toBe(true);
  });

  it("paginates distinctly — page 2 has no overlap with page 1 and matches the total", async () => {
    const page1 = await service().search("experience number", 1, 25);
    const page2 = await service().search("experience number", 2, 25);

    expect(page1.results).toHaveLength(25);
    expect(page2.results).toHaveLength(25);
    const page1Ids = new Set(
      page1.results.map((r) => (r.type === "experience" ? r.id : r.citySlug)),
    );
    const page2Ids = page2.results.map((r) => (r.type === "experience" ? r.id : r.citySlug));
    for (const id of page2Ids) expect(page1Ids.has(id)).toBe(false);
    expect(page1.pagination.total).toBeGreaterThanOrEqual(FILLER_COUNT);
  });

  it("empty query returns the featured fallback: every curated destination + top-rated experiences", async () => {
    const response = await service().search("");

    const destinationSlugs = response.results
      .filter((r) => r.type === "destination")
      .map((r) => (r.type === "destination" ? r.citySlug : ""));
    for (const c of CURATED_CITIES) expect(destinationSlugs).toContain(c.slug);
  });

  it("stays comfortably under the 500ms AC budget at ~5,000-row scale", async () => {
    const start = performance.now();
    await service().search("walking museum");
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(500);
  });

  it("renaming a City propagates to its Experiences' searchVector (propagate trigger)", async () => {
    const exp = await prisma.experience.create({
      data: {
        title: "Unnamed Coastal Lookout Walk",
        description: "A short walk with a long view.",
        status: "published",
        latitude: 38.7,
        longitude: -9.1,
        cityId: cityIdBySlug["lisbon"],
        sourceProvider: PROVIDER,
        sourceProviderTourId: "needle-city-rename",
      },
    });

    const beforeRename = await service().search("Zzyzxville");
    expect(
      beforeRename.results.some((r) => r.type === "experience" && r.id === exp.id),
    ).toBe(false);

    await prisma.city.update({
      where: { countrySlug_slug: { countrySlug: "portugal", slug: "lisbon" } },
      data: { name: "Zzyzxville" },
    });
    try {
      const afterRename = await service().search("Zzyzxville coastal lookout");
      expect(
        afterRename.results.some((r) => r.type === "experience" && r.id === exp.id),
      ).toBe(true);
    } finally {
      // Restore immediately — other specs (and other tests below) assume the
      // real curated name.
      await prisma.city.update({
        where: { countrySlug_slug: { countrySlug: "portugal", slug: "lisbon" } },
        data: { name: "Lisbon" },
      });
    }
  });
});
