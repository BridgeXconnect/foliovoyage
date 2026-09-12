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
 * table scan. Each filler Experience is now (ST-16 / BRI-128) also linked to a
 * Tour carrying price/rating/duration — spread across bands/values and with a
 * deliberate null mix roughly matching the real catalogue's population rates
 * (checked live against `atlas-folio-voyage`: price 100%, duration 76%, rating
 * 40%) — so the composable filters are exercised at real scale too, not just
 * text search.
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

/**
 * Price-band spread (ST-16 / BRI-128), minor units — deliberately one value per
 * band (`$`/`$$`/`$$$`/`$$$$`) cycled across the filler set, mirroring the real
 * spread confirmed against the live 837-tour catalogue (no single band is a
 * rounding error there either: 153/230/123/331).
 */
const FILLER_PRICE_MINOR_CYCLE = [2000, 8000, 20000, 50000];
/** Ratings cycled across the populated share of filler rows. */
const FILLER_RATING_CYCLE = [3.0, 3.5, 4.0, 4.5, 5.0];
/** Durations (minutes) cycled across the populated share of filler rows. */
const FILLER_DURATION_MIN_CYCLE = [60, 180, 360, 600, 1440];
/** Roughly matches the real catalogue's ~40% rating / ~76% duration population
 * (checked live against `atlas-folio-voyage`, 336/837 and 638/837) — every 3rd
 * row gets no rating, every 4th gets no duration, so null-handling is actually
 * exercised at scale, not just correctness on a couple of hand-built rows. */
const FILLER_UNRATED_EVERY = 3;
const FILLER_NO_DURATION_EVERY = 4;

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

  // ST-16 / BRI-128: link one Tour per filler Experience carrying
  // price/rating/duration, so the composable filters are exercised at the same
  // 5,000-row scale, not just correctness on a couple of hand-built "needle"
  // rows. `createMany` doesn't return the created rows, so look the ids back up
  // by the unique `sourceProviderTourId` key just assigned above.
  const createdFillers = await prisma.experience.findMany({
    where: { sourceProvider: PROVIDER },
    select: { id: true, sourceProviderTourId: true },
  });
  const experienceIdByFillerKey = new Map(
    createdFillers.map((e) => [e.sourceProviderTourId, e.id]),
  );
  const tourData = fillerData.map((f, i) => ({
    provider: PROVIDER,
    providerTourId: `filler-tour-${i}`,
    title: f.title,
    // Non-null by construction here (every filler Experience got a matching
    // Tour row above) — the map lookup can't miss.
    experienceId: experienceIdByFillerKey.get(f.sourceProviderTourId) as string,
    // Filler rows are already-USD (currency + priceReferenceMinor mirror
    // priceMinor) so the pre-existing band/filter assertions below stay
    // meaningful post-currency-fix; the dedicated currency-correctness test
    // is the one row where priceMinor/priceReferenceMinor deliberately diverge.
    currency: "USD",
    priceMinor: FILLER_PRICE_MINOR_CYCLE[i % FILLER_PRICE_MINOR_CYCLE.length],
    priceReferenceMinor: FILLER_PRICE_MINOR_CYCLE[i % FILLER_PRICE_MINOR_CYCLE.length],
    priceReferenceCurrency: "USD",
    ratingAvg:
      i % FILLER_UNRATED_EVERY === 0
        ? null
        : FILLER_RATING_CYCLE[i % FILLER_RATING_CYCLE.length],
    durationMin:
      i % FILLER_NO_DURATION_EVERY === 0
        ? null
        : FILLER_DURATION_MIN_CYCLE[i % FILLER_DURATION_MIN_CYCLE.length],
    fetchedAt: new Date(),
    sourceHash: `filler-hash-${i}`,
  }));
  for (let i = 0; i < tourData.length; i += CHUNK) {
    await prisma.tour.createMany({ data: tourData.slice(i, i + CHUNK) });
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

/**
 * Composable filters (ST-16 / BRI-128), exercised against the same 5,000-row
 * filler set — each linked to a Tour via {@link FILLER_PRICE_MINOR_CYCLE} /
 * {@link FILLER_RATING_CYCLE} / {@link FILLER_DURATION_MIN_CYCLE} (see
 * `beforeAll` above). Needle Experiences created in the suite above have no
 * linked Tour, so every filter here excludes them automatically via the
 * LEFT JOIN LATERAL's null result — no special-casing needed in these tests.
 */
describe("SearchService filters (ST-16 / BRI-128)", () => {
  it("single filter: priceBand narrows results to that band only", async () => {
    const response = await service().search("", 1, 25, { priceBands: ["$"] });
    const experienceResults = response.results.filter((r) => r.type === "experience");

    expect(experienceResults.length).toBeGreaterThan(0);
    for (const r of experienceResults) {
      if (r.type === "experience") expect(r.priceBand).toBe("$");
    }
    // Roughly a quarter of the 5,000 filler rows (one band of four) — a loose
    // bound, not an exact count, so this doesn't couple to unrelated tests'
    // needle rows created elsewhere in this file.
    expect(response.pagination.total).toBeGreaterThan(1000);
    expect(response.pagination.total).toBeLessThan(1500);
  });

  it("single filter: minRating narrows results to that threshold", async () => {
    const response = await service().search("", 1, 25, { minRating: 4.5 });
    const experienceResults = response.results.filter((r) => r.type === "experience");

    expect(experienceResults.length).toBeGreaterThan(0);
    for (const r of experienceResults) {
      if (r.type !== "experience") continue;
      const tour = await prisma.tour.findFirst({ where: { experienceId: r.id } });
      expect(tour?.ratingAvg).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("single filter: duration range narrows results to that window", async () => {
    const response = await service().search("", 1, 25, {
      minDurationMin: 300,
      maxDurationMin: 700,
    });
    const experienceResults = response.results.filter((r) => r.type === "experience");

    expect(experienceResults.length).toBeGreaterThan(0);
    for (const r of experienceResults) {
      if (r.type !== "experience") continue;
      const tour = await prisma.tour.findFirst({ where: { experienceId: r.id } });
      expect(tour?.durationMin).toBeGreaterThanOrEqual(300);
      expect(tour?.durationMin).toBeLessThanOrEqual(700);
    }
  });

  it("combines two filters with AND semantics, not OR", async () => {
    const response = await service().search("", 1, 25, {
      priceBands: ["$$$$"],
      minRating: 4.5,
    });
    const experienceResults = response.results.filter((r) => r.type === "experience");

    expect(experienceResults.length).toBeGreaterThan(0);
    for (const r of experienceResults) {
      if (r.type !== "experience") continue;
      expect(r.priceBand).toBe("$$$$");
      const tour = await prisma.tour.findFirst({ where: { experienceId: r.id } });
      expect(tour?.ratingAvg).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("combines a filter with a text query — both must match", async () => {
    const response = await service().search("museum", 1, 25, { priceBands: ["$"] });
    const experienceResults = response.results.filter((r) => r.type === "experience");

    expect(experienceResults.length).toBeGreaterThan(0);
    for (const r of experienceResults) {
      if (r.type !== "experience") continue;
      expect(r.title.toLowerCase()).toContain("museum");
      expect(r.priceBand).toBe("$");
    }
  });

  it("an unsatisfiable filter combination returns an honest empty result, not an error", async () => {
    // No filler duration exceeds 1440 (the top of FILLER_DURATION_MIN_CYCLE).
    const response = await service().search("", 1, 25, {
      minRating: 4.9,
      minDurationMin: 5000,
    });

    expect(response.results).toEqual([]);
    expect(response.pagination.total).toBe(0);
  });

  it("excludes Destination results outright once an Experience-scoped filter is active", async () => {
    // Baseline: an unfiltered "Bangkok" search does return the City.
    const unfiltered = await service().search("Bangkok");
    expect(
      unfiltered.results.some((r) => r.type === "destination" && r.citySlug === "bangkok"),
    ).toBe(true);

    // Same query, with a price filter active: the City must not appear, even
    // though it still text-matches — Cities have no price to filter on.
    const filtered = await service().search("Bangkok", 1, 12, { priceBands: ["$"] });
    expect(filtered.results.every((r) => r.type !== "destination")).toBe(true);
  });

  it("bands and filters on the USD reference price, not the currency-blind raw priceMinor", async () => {
    // Real thresholds (major USD): low=40, mid=120, high=300
    // (PRICE_BAND_MAJOR_THRESHOLDS in destination.service.ts).
    //
    // Raw priceMinor: 500000 (THB) -> major 5000 -> would band "$$$$" if the
    // search bands on the currency-blind supplier value.
    // priceReferenceMinor: 3000 (USD) -> major 30 -> correctly bands "$".
    // These two values provably land in different bands under the real
    // thresholds, so a passing test proves the fix, not an accident.
    const exp = await prisma.experience.create({
      data: {
        title: "Currency Correctness Probe Excursion",
        description: "Fixture proving price bands use the USD reference value, not raw priceMinor.",
        status: "published",
        latitude: CURATED_CITIES.find((c) => c.slug === "bangkok")!.centroidLat,
        longitude: CURATED_CITIES.find((c) => c.slug === "bangkok")!.centroidLng,
        cityId: cityIdBySlug["bangkok"],
        sourceProvider: PROVIDER,
        sourceProviderTourId: "currency-probe",
      },
    });
    await prisma.tour.create({
      data: {
        provider: PROVIDER,
        providerTourId: "currency-probe-tour",
        title: exp.title,
        experienceId: exp.id,
        currency: "THB",
        priceMinor: 500000,
        priceReferenceMinor: 3000,
        priceReferenceCurrency: "USD",
        fetchedAt: new Date(),
        sourceHash: "currency-probe-hash",
      },
    });

    const bySearch = await service().search("Currency Correctness Probe Excursion");
    const match = bySearch.results.find(
      (r) => r.type === "experience" && r.id === exp.id,
    );
    expect(match).toBeDefined();
    if (match?.type === "experience") {
      expect(match.priceBand).toBe("$"); // reference band, not "$$$$" from raw priceMinor
    }

    // The price-band filter matches on the reference band...
    const correctBandFiltered = await service().search(
      "Currency Correctness Probe Excursion",
      1,
      25,
      { priceBands: ["$"] },
    );
    expect(
      correctBandFiltered.results.some((r) => r.type === "experience" && r.id === exp.id),
    ).toBe(true);

    // ...not the raw band the un-normalized priceMinor would fall into.
    const rawBandFiltered = await service().search(
      "Currency Correctness Probe Excursion",
      1,
      25,
      { priceBands: ["$$$$"] },
    );
    expect(
      rawBandFiltered.results.some((r) => r.type === "experience" && r.id === exp.id),
    ).toBe(false);
  });

  it("EXPLAIN ANALYZE: a filtered text query never falls back to a full table scan", async () => {
    const rows = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>`
      EXPLAIN (ANALYZE, FORMAT TEXT)
      SELECT e.id, ts_rank_cd(e."searchVector", query, 32) AS "textRank"
      FROM "Experience" e
      CROSS JOIN plainto_tsquery('english', 'museum') AS query
      LEFT JOIN LATERAL (
        SELECT t."priceReferenceMinor", t."ratingAvg", t."durationMin"
        FROM "Tour" t
        WHERE t."experienceId" = e.id AND t."deletedAt" IS NULL
        ORDER BY t."updatedAt" DESC
        LIMIT 1
      ) tour ON true
      WHERE e.status = 'published' AND e."searchVector" @@ query
        AND tour."priceReferenceMinor" <= 4000
      ORDER BY "textRank" DESC, e.id ASC
      LIMIT 12
    `;
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");

    // Real finding at this table size (~5-6K Experience rows): the planner
    // prefers the `(cityId, status)` composite index (`Experience_cityId_status_idx`,
    // used by the destinations read path) over the `searchVector` GIN index for
    // this WHERE-clause shape — both are legitimate index scans, and execution
    // stays under a few ms either way, but it's the *other* index, not the GIN
    // one ST-13's own docstring implies. Documented, not assumed: don't assert
    // GIN specifically here, only that it's never a full scan.
    expect(plan).not.toContain('Seq Scan on "Experience"');
    expect(plan).toMatch(/Index Scan|Bitmap Index Scan/);
  });
});
