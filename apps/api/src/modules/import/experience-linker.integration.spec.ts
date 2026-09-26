import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

import { CURATED_CITIES } from "./curated-cities";
import {
  ExperienceGeoUnavailableError,
  ExperienceLinker,
} from "./experience-linker";

/**
 * Integration tests for {@link ExperienceLinker} (ST-11 / BRI-164) against a
 * **real Postgres**. These are the acceptance-criteria tests the story insists
 * be *run*, not reasoned about:
 *
 * - a curated tour gets a linked draft Experience (never published);
 * - a null-geo tour's Experience falls back to the city centroid, not a
 *   constraint violation;
 * - re-running links nothing new (idempotent) and creates no duplicate;
 * - a tour matching no curated city is left unlinked (curation at the import
 *   layer);
 * - a city missing its centroid + a null-geo tour fails loudly, writing nothing.
 *
 * Fixtures are scoped by a dedicated `provider: "linker-test"` so they never
 * touch the `viator` rows the other integration specs manage. Curated City rows
 * are reset from the registry around each test.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

const PROVIDER = "linker-test";
const BANGKOK = CURATED_CITIES.find((c) => c.slug === "bangkok")!;

function linker(): ExperienceLinker {
  return new ExperienceLinker(prisma);
}

/** Upsert a curated City from the registry, restoring its known-good centroid. */
async function resetCity(slug: string): Promise<{ id: string }> {
  const c = CURATED_CITIES.find((x) => x.slug === slug)!;
  return prisma.city.upsert({
    where: { countrySlug_slug: { countrySlug: c.countrySlug, slug: c.slug } },
    update: {
      viatorDestRef: c.primaryRef,
      centroidLat: c.centroidLat,
      centroidLng: c.centroidLng,
      heroImageUrl: c.heroImageUrl,
      heroImageAlt: c.heroImageAlt,
      name: c.name,
      country: c.country,
    },
    create: {
      slug: c.slug,
      countrySlug: c.countrySlug,
      name: c.name,
      country: c.country,
      heroImageUrl: c.heroImageUrl,
      heroImageAlt: c.heroImageAlt,
      viatorDestRef: c.primaryRef,
      centroidLat: c.centroidLat,
      centroidLng: c.centroidLng,
    },
    select: { id: true },
  });
}

/** Create a bare imported tour (as ST-9 would leave it, pre-linking). */
async function makeTour(
  providerTourId: string,
  overrides: {
    destinationRefs?: string[];
    latitude?: number | null;
    longitude?: number | null;
    deletedAt?: Date | null;
  } = {},
): Promise<{ id: string }> {
  return prisma.tour.create({
    data: {
      provider: PROVIDER,
      providerTourId,
      title: `Tour ${providerTourId}`,
      description: `Desc ${providerTourId}`,
      destinationRefs: overrides.destinationRefs ?? [BANGKOK.primaryRef],
      latitude: overrides.latitude ?? null,
      longitude: overrides.longitude ?? null,
      deletedAt: overrides.deletedAt ?? null,
      imageUrl: "https://img/x.jpg",
      priceMinor: 5000,
      currency: "USD",
      fetchedAt: new Date(),
      sourceHash: `hash-${providerTourId}`,
    },
    select: { id: true },
  });
}

async function cleanup(): Promise<void> {
  await prisma.tour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.experience.deleteMany({ where: { sourceProvider: PROVIDER } });
}

beforeEach(async () => {
  await cleanup();
  await resetCity("bangkok");
});

afterAll(async () => {
  await cleanup();
  // Restore every curated city's centroid to the registry (seed) values.
  for (const c of CURATED_CITIES) await resetCity(c.slug);
  await prisma.$disconnect();
});

describe("ExperienceLinker.linkRun", () => {
  it("auto-creates a draft Experience linked 1:1 to a curated tour", async () => {
    const tour = await makeTour("T1", { latitude: 13.7, longitude: 100.5 });

    const result = await linker().linkRun(PROVIDER);
    expect(result).toEqual({ created: 1, linked: 1, skippedMissingCity: 0 });

    const exp = await prisma.experience.findUnique({
      where: {
        sourceProvider_sourceProviderTourId: {
          sourceProvider: PROVIDER,
          sourceProviderTourId: "T1",
        },
      },
    });
    expect(exp).not.toBeNull();
    expect(exp!.status).toBe("draft"); // never published on auto-create
    expect(exp!.latitude).toBe(13.7); // the tour's own geo
    expect(exp!.longitude).toBe(100.5);

    const linked = await prisma.tour.findUnique({ where: { id: tour.id } });
    expect(linked!.experienceId).toBe(exp!.id);
  });

  it("falls back to the city centroid when the tour has no geo (no constraint violation)", async () => {
    await makeTour("T2", { latitude: null, longitude: null });

    await linker().linkRun(PROVIDER);

    const exp = await prisma.experience.findUnique({
      where: {
        sourceProvider_sourceProviderTourId: {
          sourceProvider: PROVIDER,
          sourceProviderTourId: "T2",
        },
      },
    });
    expect(exp!.latitude).toBe(BANGKOK.centroidLat);
    expect(exp!.longitude).toBe(BANGKOK.centroidLng);
  });

  it("falls back to the Bali sub-region centre when a Bali tour has no geo (BRI-218)", async () => {
    await resetCity("bali");
    await makeTour("BALI-UBUD", { destinationRefs: ["5467"] }); // Ubud

    await linker().linkRun(PROVIDER);

    const exp = await prisma.experience.findUnique({
      where: {
        sourceProvider_sourceProviderTourId: {
          sourceProvider: PROVIDER,
          sourceProviderTourId: "BALI-UBUD",
        },
      },
    });
    expect(exp!.latitude).toBeCloseTo(-8.5192680019, 6); // Ubud centre, not the island centroid
    expect(exp!.longitude).toBeCloseTo(115.2632979979, 6);
  });

  it("does not use a sub-region fallback for a non-Bali tour: it gets the city centroid (BRI-218)", async () => {
    await makeTour("BKK-1"); // Bangkok, no geo

    await linker().linkRun(PROVIDER);

    const exp = await prisma.experience.findUnique({
      where: {
        sourceProvider_sourceProviderTourId: {
          sourceProvider: PROVIDER,
          sourceProviderTourId: "BKK-1",
        },
      },
    });
    expect(exp!.latitude).toBe(BANGKOK.centroidLat);
    expect(exp!.longitude).toBe(BANGKOK.centroidLng);
  });

  it("is idempotent — a re-run creates no duplicate and links nothing new", async () => {
    await makeTour("T3", { latitude: 13.7, longitude: 100.5 });

    const first = await linker().linkRun(PROVIDER);
    expect(first).toEqual({ created: 1, linked: 1, skippedMissingCity: 0 });

    const second = await linker().linkRun(PROVIDER);
    expect(second).toEqual({ created: 0, linked: 0, skippedMissingCity: 0 });

    const count = await prisma.experience.count({
      where: { sourceProvider: PROVIDER, sourceProviderTourId: "T3" },
    });
    expect(count).toBe(1);
  });

  it("leaves a tour matching no curated city unlinked (curation at import layer)", async () => {
    const tour = await makeTour("T4", { destinationRefs: ["99999"] });

    const result = await linker().linkRun(PROVIDER);
    expect(result.created).toBe(0);

    const reloaded = await prisma.tour.findUnique({ where: { id: tour.id } });
    expect(reloaded!.experienceId).toBeNull();
    const anyExp = await prisma.experience.count({
      where: { sourceProvider: PROVIDER, sourceProviderTourId: "T4" },
    });
    expect(anyExp).toBe(0);
  });

  it("ignores soft-deleted tours", async () => {
    const tour = await makeTour("T5", {
      latitude: 13.7,
      longitude: 100.5,
      deletedAt: new Date(),
    });

    const result = await linker().linkRun(PROVIDER);
    expect(result.created).toBe(0);

    const reloaded = await prisma.tour.findUnique({ where: { id: tour.id } });
    expect(reloaded!.experienceId).toBeNull();
  });

  it("fails loudly when the tour has no geo and the city has no centroid", async () => {
    // Null out Bangkok's centroid so there is nothing to fall back to.
    await prisma.city.update({
      where: {
        countrySlug_slug: {
          countrySlug: BANGKOK.countrySlug,
          slug: BANGKOK.slug,
        },
      },
      data: { centroidLat: null, centroidLng: null },
    });
    await makeTour("T6", { latitude: null, longitude: null });

    await expect(linker().linkRun(PROVIDER)).rejects.toBeInstanceOf(
      ExperienceGeoUnavailableError,
    );

    // Nothing was written — no null-geo Experience slipped through.
    const count = await prisma.experience.count({
      where: { sourceProvider: PROVIDER, sourceProviderTourId: "T6" },
    });
    expect(count).toBe(0);
  });
});
