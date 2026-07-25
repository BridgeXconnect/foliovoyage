import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

import { CURATED_CITIES } from "./curated-cities";
import {
  ExperienceGeoUnavailableError,
  ExperienceLinker,
} from "./experience-linker";

/**
 * ADVERSARIAL integration tests for {@link ExperienceLinker} (ST-11 / BRI-164).
 *
 * These deliberately try to *break* auto-create-Experience, not confirm the
 * happy path — the same bar as ST-9's mass-deletion abort guard, because this
 * runs unattended in the nightly import. They probe the three story scenarios:
 *
 *  1. Re-running an import for an already-linked tour (incl. a cleared back-link
 *     with the Experience still present, and a create-then-crash-before-link
 *     recovery) — must converge, never duplicate.
 *  2. A city missing its centroid — must fail loudly and write no null/spliced
 *     location; also the coordinate-source splice hazard (half-geo tour).
 *  3. Concurrent / overlapping runs on the same tour — a real `Promise.all`
 *     race must yield exactly one Experience and one link, never a duplicate,
 *     crash, or orphan.
 *
 * Fixtures are scoped by a dedicated `provider: "linker-adversarial"` so they
 * never touch the `viator` seed rows or the `linker-test` spec's fixtures.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

const PROVIDER = "linker-adversarial";
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
    experienceId?: string | null;
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
      experienceId: overrides.experienceId ?? null,
      imageUrl: "https://img/x.jpg",
      priceMinor: 5000,
      currency: "USD",
      fetchedAt: new Date(),
      sourceHash: `hash-${providerTourId}`,
    },
    select: { id: true },
  });
}

async function expForTour(providerTourId: string) {
  return prisma.experience.findUnique({
    where: {
      sourceProvider_sourceProviderTourId: {
        sourceProvider: PROVIDER,
        sourceProviderTourId: providerTourId,
      },
    },
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
  // Restore every curated city's centroid to the registry (seed) values, in
  // case a test nulled one.
  for (const c of CURATED_CITIES) await resetCity(c.slug);
  await prisma.$disconnect();
});

describe("ExperienceLinker — idempotency under partial / corrupted prior state", () => {
  it("re-links a tour whose back-link was cleared but whose Experience still exists (no duplicate)", async () => {
    // First pass creates + links.
    const tour = await makeTour("A1", { latitude: 13.7, longitude: 100.5 });
    const first = await linker().linkRun(PROVIDER);
    expect(first).toEqual({ created: 1, linked: 1, skippedMissingCity: 0 });
    const exp = await expForTour("A1");
    expect(exp).not.toBeNull();

    // Simulate manual/accidental clearing of the FK (Experience row survives —
    // source-key collision on the next run).
    await prisma.tour.update({
      where: { id: tour.id },
      data: { experienceId: null },
    });

    // Re-run: must re-attach to the SAME Experience via the P2002 read-back path,
    // creating nothing new.
    const second = await linker().linkRun(PROVIDER);
    expect(second.created).toBe(0);
    expect(second.linked).toBe(1);

    const count = await prisma.experience.count({
      where: { sourceProvider: PROVIDER, sourceProviderTourId: "A1" },
    });
    expect(count).toBe(1);
    const reloaded = await prisma.tour.findUnique({ where: { id: tour.id } });
    expect(reloaded!.experienceId).toBe(exp!.id);
  });

  it("recovers when the Experience exists but the tour was never back-linked (create-then-crash)", async () => {
    // Model the midway-failure state directly: an Experience already exists for
    // the source key, but the tour still has experienceId = null (the back-link
    // updateMany never ran).
    const city = await resetCity("bangkok");
    const orphan = await prisma.experience.create({
      data: {
        title: "Tour A2",
        description: "Desc A2",
        status: "draft",
        latitude: 13.7,
        longitude: 100.5,
        cityId: city.id,
        sourceProvider: PROVIDER,
        sourceProviderTourId: "A2",
      },
      select: { id: true },
    });
    const tour = await makeTour("A2", { latitude: 13.7, longitude: 100.5 });

    const result = await linker().linkRun(PROVIDER);
    // create() collides (P2002) → read-back → link. Nothing new created.
    expect(result.created).toBe(0);
    expect(result.linked).toBe(1);

    const count = await prisma.experience.count({
      where: { sourceProvider: PROVIDER, sourceProviderTourId: "A2" },
    });
    expect(count).toBe(1);
    const reloaded = await prisma.tour.findUnique({ where: { id: tour.id } });
    expect(reloaded!.experienceId).toBe(orphan.id);
  });

  it("stays a no-op across three consecutive runs (no drift, no duplicates)", async () => {
    await makeTour("A3", { latitude: 13.7, longitude: 100.5 });
    await linker().linkRun(PROVIDER);
    const r2 = await linker().linkRun(PROVIDER);
    const r3 = await linker().linkRun(PROVIDER);
    expect(r2).toEqual({ created: 0, linked: 0, skippedMissingCity: 0 });
    expect(r3).toEqual({ created: 0, linked: 0, skippedMissingCity: 0 });
    const count = await prisma.experience.count({
      where: { sourceProvider: PROVIDER },
    });
    expect(count).toBe(1);
  });
});

describe("ExperienceLinker — geo integrity (never null, never spliced)", () => {
  it("does NOT splice a tour coordinate onto a city coordinate for a half-geo tour", async () => {
    // Tour has a latitude but no longitude (a malformed half-pair). The city has
    // a full centroid. A per-field coalesce would produce (tour.lat, city.lng) —
    // a fabricated point that is NEITHER the tour's nor the city's location.
    // Correct behaviour: treat geo as an atomic pair and fall back to the full
    // city centroid.
    await makeTour("G1", { latitude: 13.9, longitude: null });

    await linker().linkRun(PROVIDER);

    const exp = await expForTour("G1");
    expect(exp).not.toBeNull();
    // Must be the coherent city centroid pair, not a splice.
    expect(exp!.latitude).toBe(BANGKOK.centroidLat);
    expect(exp!.longitude).toBe(BANGKOK.centroidLng);
    // Explicitly assert the splice did NOT happen.
    expect(exp!.latitude).not.toBe(13.9);
  });

  it("does NOT splice when the tour has longitude only", async () => {
    await makeTour("G2", { latitude: null, longitude: 100.9 });

    await linker().linkRun(PROVIDER);

    const exp = await expForTour("G2");
    expect(exp!.latitude).toBe(BANGKOK.centroidLat);
    expect(exp!.longitude).toBe(BANGKOK.centroidLng);
    expect(exp!.longitude).not.toBe(100.9);
  });

  it("uses the full tour pair when both coordinates are present (tour geo wins)", async () => {
    await makeTour("G3", { latitude: 13.111, longitude: 100.222 });
    await linker().linkRun(PROVIDER);
    const exp = await expForTour("G3");
    expect(exp!.latitude).toBe(13.111);
    expect(exp!.longitude).toBe(100.222);
  });

  it("fails loudly on a half-geo tour when the city centroid is also partial (no splice, no null write)", async () => {
    // City has only a latitude centroid; tour has only a longitude. Neither
    // source yields a complete pair — must throw, not fabricate or write null.
    await prisma.city.update({
      where: {
        countrySlug_slug: {
          countrySlug: BANGKOK.countrySlug,
          slug: BANGKOK.slug,
        },
      },
      data: { centroidLat: 13.72, centroidLng: null },
    });
    await makeTour("G4", { latitude: null, longitude: 100.9 });

    await expect(linker().linkRun(PROVIDER)).rejects.toBeInstanceOf(
      ExperienceGeoUnavailableError,
    );
    const count = await prisma.experience.count({
      where: { sourceProvider: PROVIDER, sourceProviderTourId: "G4" },
    });
    expect(count).toBe(0);
  });

  it("the geo-unavailable tour itself writes nothing even when it throws mid-run", async () => {
    // Null Bangkok's centroid, then a null-geo tour → the failing tour must leave
    // no Experience and no link behind (per-tour atomicity: the geo check runs
    // before any write for that tour).
    await prisma.city.update({
      where: {
        countrySlug_slug: {
          countrySlug: BANGKOK.countrySlug,
          slug: BANGKOK.slug,
        },
      },
      data: { centroidLat: null, centroidLng: null },
    });
    const tour = await makeTour("G5", { latitude: null, longitude: null });

    await expect(linker().linkRun(PROVIDER)).rejects.toBeInstanceOf(
      ExperienceGeoUnavailableError,
    );

    const count = await prisma.experience.count({
      where: { sourceProvider: PROVIDER, sourceProviderTourId: "G5" },
    });
    expect(count).toBe(0);
    const reloaded = await prisma.tour.findUnique({ where: { id: tour.id } });
    expect(reloaded!.experienceId).toBeNull();
  });
});

describe("ExperienceLinker — concurrency / racing runs (the load-bearing property)", () => {
  it("two linkRun() racing the same unlinked tour yield exactly one Experience and one link", async () => {
    const tour = await makeTour("R1", { latitude: 13.7, longitude: 100.5 });

    // Fire two full linking passes at the same tour concurrently.
    const [a, b] = await Promise.all([
      linker().linkRun(PROVIDER),
      linker().linkRun(PROVIDER),
    ]);

    // Exactly one Experience exists for the source key — the unique constraint
    // + P2002 read-back must have collapsed the duplicate create.
    const experiences = await prisma.experience.findMany({
      where: { sourceProvider: PROVIDER, sourceProviderTourId: "R1" },
    });
    expect(experiences).toHaveLength(1);

    // The tour points at that one Experience.
    const reloaded = await prisma.tour.findUnique({ where: { id: tour.id } });
    expect(reloaded!.experienceId).toBe(experiences[0].id);

    // Across both runs, exactly one create and exactly one link happened — no
    // double-count, no lost link. This proves the `experienceId IS NULL` guarded
    // updateMany is race-safe at the DB level (only one UPDATE sees a null FK).
    expect(a.created + b.created).toBe(1);
    expect(a.linked + b.linked).toBe(1);
  });

  it("two linkRun() racing many unlinked tours produce one Experience per tour, all linked", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `M${i}`);
    // Mix of geo-bearing and centroid-fallback tours to widen the race surface.
    await Promise.all(
      ids.map((id, i) =>
        makeTour(id, {
          latitude: i % 2 === 0 ? 13.7 + i / 1000 : null,
          longitude: i % 2 === 0 ? 100.5 + i / 1000 : null,
        }),
      ),
    );

    const [a, b] = await Promise.all([
      linker().linkRun(PROVIDER),
      linker().linkRun(PROVIDER),
    ]);

    // Exactly one Experience per tour — no duplicates anywhere.
    const experiences = await prisma.experience.findMany({
      where: { sourceProvider: PROVIDER },
    });
    expect(experiences).toHaveLength(ids.length);
    const sourceKeys = new Set(experiences.map((e) => e.sourceProviderTourId));
    expect(sourceKeys.size).toBe(ids.length);

    // Every tour is linked to its own Experience.
    const tours = await prisma.tour.findMany({ where: { provider: PROVIDER } });
    for (const t of tours) expect(t.experienceId).not.toBeNull();

    // Combined, each tour was created once and linked once.
    expect(a.created + b.created).toBe(ids.length);
    expect(a.linked + b.linked).toBe(ids.length);
  });

  it("a run racing an already-linked tour creates nothing (re-run convergence under concurrency)", async () => {
    const tour = await makeTour("R2", { latitude: 13.7, longitude: 100.5 });
    // Link it first, serially.
    await linker().linkRun(PROVIDER);
    const exp = await expForTour("R2");

    // Now race two more runs against the already-linked tour.
    const [a, b] = await Promise.all([
      linker().linkRun(PROVIDER),
      linker().linkRun(PROVIDER),
    ]);
    expect(a.created + b.created).toBe(0);
    expect(a.linked + b.linked).toBe(0);

    const count = await prisma.experience.count({
      where: { sourceProvider: PROVIDER, sourceProviderTourId: "R2" },
    });
    expect(count).toBe(1);
    const reloaded = await prisma.tour.findUnique({ where: { id: tour.id } });
    expect(reloaded!.experienceId).toBe(exp!.id);
  });
});
