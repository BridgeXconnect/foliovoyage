import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";
import { createPrismaSnapshotStore } from "./tour-copy-golden-snapshot.cli";

/**
 * Integration test for the snapshot CLI's real query against **Postgres**
 * (BRI-201 / spec 0003, AC-14): only live tours on a published Experience
 * that pass the rating gate come back, with the city slug and any recorded
 * failure reasons. No model call is made.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const prisma = new PrismaClient(DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined);
const store = createPrismaSnapshotStore(prisma as unknown as PrismaService);

const PROVIDER = "tour-copy-snapshot-test";
const COUNTRY_SLUG = "tour-copy-snapshot-land";

let cityId = "";

async function seedTour(
  providerTourId: string,
  options: { experienceStatus?: string; ratingAvg?: number | null; ratingCount?: number; deleted?: boolean; description?: string | null; failureReasons?: string[] } = {},
): Promise<string> {
  const experience = await prisma.experience.create({
    data: {
      title: `Experience ${providerTourId}`,
      description: "An experience.",
      status: options.experienceStatus ?? "published",
      latitude: 1,
      longitude: 1,
      cityId,
      sourceProvider: PROVIDER,
      sourceProviderTourId: providerTourId,
    },
    select: { id: true },
  });
  const tour = await prisma.tour.create({
    data: {
      provider: PROVIDER,
      providerTourId,
      title: `Tour ${providerTourId}`,
      description: options.description === undefined ? "A calm boat ride." : options.description,
      durationMin: 60,
      inclusions: [] as never,
      exclusions: [] as never,
      ratingAvg: options.ratingAvg === undefined ? 4.6 : options.ratingAvg,
      ratingCount: options.ratingCount ?? 20,
      experienceId: experience.id,
      fetchedAt: new Date(),
      sourceHash: `hash-${providerTourId}`,
      ...(options.deleted ? { deletedAt: new Date() } : {}),
    },
    select: { id: true },
  });
  if (options.failureReasons !== undefined) {
    await prisma.tourCopy.create({
      data: {
        tourId: tour.id,
        status: "failed",
        groundingHash: "h",
        model: "claude-sonnet-5",
        promptVersion: 4,
        generatedAt: new Date(),
        attempts: 2,
        failureReasons: options.failureReasons,
        runId: "seed_run",
      },
    });
  }
  return tour.id;
}

async function cleanup(): Promise<void> {
  await prisma.tourCopy.deleteMany({ where: { tour: { provider: PROVIDER } } });
  await prisma.tour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.experience.deleteMany({ where: { sourceProvider: PROVIDER } });
  await prisma.city.deleteMany({ where: { countrySlug: COUNTRY_SLUG } });
}

beforeEach(async () => {
  await cleanup();
  cityId = (
    await prisma.city.create({
      data: {
        slug: "snapshot-city",
        countrySlug: COUNTRY_SLUG,
        name: "Snapshot City",
        country: "Snapshotland",
        heroImageUrl: "https://example.test/hero.jpg",
        heroImageAlt: "hero",
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("tour-copy-golden:snapshot store (integration, spec 0003 AC-14)", () => {
  it("returns live, eligible tours on a published Experience, with city slug and failure reasons", async () => {
    const good = await seedTour("S1", { failureReasons: ["word_count", "low_overlap"] });
    const plain = await seedTour("S2");
    const draft = await seedTour("S3", { experienceStatus: "draft" });
    const lowRating = await seedTour("S4", { ratingAvg: 3.2 });
    const fewReviews = await seedTour("S5", { ratingCount: 2 });
    const deleted = await seedTour("S6", { deleted: true });
    const noDescription = await seedTour("S7", { description: null });

    const candidates = await store.loadCandidates();
    const byId = new Map(candidates.map((c) => [c.id, c]));

    expect(byId.get(good)).toMatchObject({ citySlug: "snapshot-city", failureReasons: ["word_count", "low_overlap"], durationMin: 60 });
    expect(byId.get(plain)).toMatchObject({ failureReasons: [] });
    for (const excluded of [draft, lowRating, fewReviews, deleted, noDescription]) {
      expect(byId.has(excluded)).toBe(false);
    }
  });
});
