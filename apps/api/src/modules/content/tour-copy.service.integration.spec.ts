import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";
import { DestinationService } from "../../destinations/destination.service";
import type {
  TourCopyGenerationRequest,
  TourCopyGenerationResult,
  TourCopyGenerator,
} from "./tour-copy-generator";
import { TourCopyService } from "./tour-copy.service";

/**
 * Integration tests for {@link TourCopyService.generateOne} against a **real
 * Postgres**, plus {@link DestinationService.getByCountryAndCity} reading what
 * it wrote — the thin-thread slice of the build plan (task 3), covering AC-1,
 * AC-4, AC-12, and AC-16.
 *
 * Fixtures are scoped by a dedicated `provider: "tour-copy-test"` (Tours) and
 * `sourceProvider: "tour-copy-test"` (Experiences), plus a dedicated City
 * (`countrySlug: "tour-copy-test-land"`), so they never touch the `viator`
 * rows the other integration specs manage.
 *
 * The injected generator is a small fake, never the real Anthropic adapter —
 * this build must not make a real model/gateway call (calibration is a
 * separate, manual step).
 */

const DATABASE_URL = process.env.DATABASE_URL;
const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

const PROVIDER = "tour-copy-test";
const COUNTRY_SLUG = "tour-copy-test-land";
const CITY_SLUG = "tour-copy-test-city";

/** A minimal, always-eligible, never-thin description (well over MIN_SOURCE_CHARS). */
const FULL_DESCRIPTION = "A wonderful half day tour through the old town. ".repeat(8);

/** A fake {@link TourCopyGenerator} whose response is fixed per test. */
class FakeGenerator implements TourCopyGenerator {
  constructor(private readonly result: TourCopyGenerationResult) {}
  calls: TourCopyGenerationRequest[] = [];
  async generate(request: TourCopyGenerationRequest): Promise<TourCopyGenerationResult> {
    this.calls.push(request);
    return this.result;
  }
}

function service(generator: TourCopyGenerator): TourCopyService {
  return new TourCopyService(prisma as unknown as PrismaService, generator);
}

async function resetCity(): Promise<{ id: string }> {
  return prisma.city.upsert({
    where: { countrySlug_slug: { countrySlug: COUNTRY_SLUG, slug: CITY_SLUG } },
    update: {},
    create: {
      slug: CITY_SLUG,
      countrySlug: COUNTRY_SLUG,
      name: "Test City",
      country: "Testland",
      heroImageUrl: "https://example.test/hero.jpg",
      heroImageAlt: "Test City hero",
    },
    select: { id: true },
  });
}

async function makeExperience(
  providerTourId: string,
  overrides: { status?: string } = {},
): Promise<{ id: string }> {
  const city = await resetCity();
  return prisma.experience.create({
    data: {
      title: `Experience ${providerTourId}`,
      description: "An experience.",
      status: overrides.status ?? "published",
      latitude: 13.7,
      longitude: 100.5,
      cityId: city.id,
      sourceProvider: PROVIDER,
      sourceProviderTourId: providerTourId,
    },
    select: { id: true },
  });
}

interface TourOverrides {
  description?: string | null;
  durationMin?: number | null;
  inclusions?: unknown;
  exclusions?: unknown;
  ratingAvg?: number | null;
  ratingCount?: number | null;
  deletedAt?: Date | null;
  experienceId?: string | null;
}

async function makeTour(providerTourId: string, overrides: TourOverrides = {}): Promise<{ id: string }> {
  return prisma.tour.create({
    data: {
      provider: PROVIDER,
      providerTourId,
      title: `Tour ${providerTourId}`,
      description: overrides.description === undefined ? FULL_DESCRIPTION : overrides.description,
      durationMin: overrides.durationMin ?? 240,
      inclusions: (overrides.inclusions ?? []) as never,
      exclusions: (overrides.exclusions ?? []) as never,
      ratingAvg: overrides.ratingAvg === undefined ? 4.5 : overrides.ratingAvg,
      ratingCount: overrides.ratingCount === undefined ? 20 : overrides.ratingCount,
      deletedAt: overrides.deletedAt ?? null,
      experienceId: overrides.experienceId,
      fetchedAt: new Date(),
      sourceHash: `hash-${providerTourId}`,
    },
    select: { id: true },
  });
}

async function cleanup(): Promise<void> {
  await prisma.tourCopy.deleteMany({ where: { tour: { provider: PROVIDER } } });
  await prisma.tour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.experience.deleteMany({ where: { sourceProvider: PROVIDER } });
  await prisma.city.deleteMany({ where: { countrySlug: COUNTRY_SLUG } });
}

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("TourCopyService.generateOne (integration)", () => {
  it("generates and stores a published row, then the read path serves it (AC-1, AC-4, AC-12)", async () => {
    const experience = await makeExperience("T1");
    const tour = await makeTour("T1", { experienceId: experience.id });

    const generator = new FakeGenerator({
      kind: "text",
      text: "A lovely fake paragraph about this tour.",
      usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    });

    const outcome = await service(generator).generateOne(tour.id, {
      runId: "run_1",
      model: "claude-sonnet-5",
    });

    expect(outcome).toEqual({ kind: "generated", status: "published" });
    expect(generator.calls).toHaveLength(1);

    const row = await prisma.tourCopy.findUnique({ where: { tourId: tour.id } });
    expect(row?.status).toBe("published");
    expect(row?.aiSummary).toBe("A lovely fake paragraph about this tour.");

    const destinations = new DestinationService(prisma as unknown as PrismaService);
    const result = await destinations.getByCountryAndCity(COUNTRY_SLUG, CITY_SLUG);
    expect(result.experiences).toHaveLength(1);
    expect(result.experiences[0].aiSummary).toBe("A lovely fake paragraph about this tour.");
  });

  it("skips a thin-source tour without calling the generator, and the read path serves null (AC-1)", async () => {
    const experience = await makeExperience("T2");
    const tour = await makeTour("T2", { experienceId: experience.id, description: "Too short." });

    const generator = new FakeGenerator({
      kind: "text",
      text: "should never be called",
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    });

    const outcome = await service(generator).generateOne(tour.id, {
      runId: "run_1",
      model: "claude-sonnet-5",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "source_too_thin" });
    expect(generator.calls).toHaveLength(0);
    expect(await prisma.tourCopy.findUnique({ where: { tourId: tour.id } })).toBeNull();

    const destinations = new DestinationService(prisma as unknown as PrismaService);
    const result = await destinations.getByCountryAndCity(COUNTRY_SLUG, CITY_SLUG);
    expect(result.experiences[0].aiSummary).toBeNull();
  });

  it("skips an ineligible tour without calling the generator (AC-1)", async () => {
    const experience = await makeExperience("T3");
    const tour = await makeTour("T3", { experienceId: experience.id, ratingCount: 1 });

    const generator = new FakeGenerator({
      kind: "text",
      text: "should never be called",
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    });

    const outcome = await service(generator).generateOne(tour.id, {
      runId: "run_1",
      model: "claude-sonnet-5",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "not_eligible" });
    expect(generator.calls).toHaveLength(0);
  });

  it("skips a tour on a non-published Experience, and the read path shows nothing (AC-1)", async () => {
    const experience = await makeExperience("T4", { status: "draft" });
    const tour = await makeTour("T4", { experienceId: experience.id });

    const generator = new FakeGenerator({
      kind: "text",
      text: "should never be called",
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    });

    const outcome = await service(generator).generateOne(tour.id, {
      runId: "run_1",
      model: "claude-sonnet-5",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "experience_not_published" });
    expect(generator.calls).toHaveLength(0);

    // The draft Experience is invisible to the public read path entirely.
    const destinations = new DestinationService(prisma as unknown as PrismaService);
    const result = await destinations.getByCountryAndCity(COUNTRY_SLUG, CITY_SLUG);
    expect(result.experiences).toHaveLength(0);
  });

  it("skips a soft-deleted tour without calling the generator (AC-1)", async () => {
    const experience = await makeExperience("T5");
    const tour = await makeTour("T5", { experienceId: experience.id, deletedAt: new Date() });

    const generator = new FakeGenerator({
      kind: "text",
      text: "should never be called",
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    });

    const outcome = await service(generator).generateOne(tour.id, {
      runId: "run_1",
      model: "claude-sonnet-5",
    });

    expect(outcome).toEqual({ kind: "skipped", reason: "deleted" });
    expect(generator.calls).toHaveLength(0);
  });

  it("stops serving a published summary once the tour's grounding fields change (AC-12 hash mismatch)", async () => {
    const experience = await makeExperience("T6");
    const tour = await makeTour("T6", { experienceId: experience.id });

    const generator = new FakeGenerator({
      kind: "text",
      text: "Original paragraph.",
      usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    });
    await service(generator).generateOne(tour.id, { runId: "run_1", model: "claude-sonnet-5" });

    const destinations = new DestinationService(prisma as unknown as PrismaService);
    const before = await destinations.getByCountryAndCity(COUNTRY_SLUG, CITY_SLUG);
    expect(before.experiences[0].aiSummary).toBe("Original paragraph.");

    // Edit a grounding field directly (as a later import re-normalizing the
    // tour would) without regenerating the copy.
    await prisma.tour.update({ where: { id: tour.id }, data: { title: "A brand new title" } });

    const after = await destinations.getByCountryAndCity(COUNTRY_SLUG, CITY_SLUG);
    expect(after.experiences[0].aiSummary).toBeNull();
  });

  it("serves the lower-id linked tour's copy when an Experience has two Tours (determinism)", async () => {
    const experience = await makeExperience("T7");
    const first = await makeTour("T7-a", { experienceId: experience.id });
    await makeTour("T7-b", { experienceId: experience.id });

    const generator = new FakeGenerator({
      kind: "text",
      text: "First tour's paragraph.",
      usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    });
    await service(generator).generateOne(first.id, { runId: "run_1", model: "claude-sonnet-5" });

    const destinations = new DestinationService(prisma as unknown as PrismaService);
    const result = await destinations.getByCountryAndCity(COUNTRY_SLUG, CITY_SLUG);
    expect(result.experiences[0].aiSummary).toBe("First tour's paragraph.");
  });

  it("stores a failed row on refusal, and the read path serves null (thin thread has no retry yet)", async () => {
    const experience = await makeExperience("T8");
    const tour = await makeTour("T8", { experienceId: experience.id });

    const generator = new FakeGenerator({
      kind: "refusal",
      usage: { inputTokens: 1, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    });

    const outcome = await service(generator).generateOne(tour.id, {
      runId: "run_1",
      model: "claude-sonnet-5",
    });

    expect(outcome).toEqual({ kind: "generated", status: "failed" });
    const row = await prisma.tourCopy.findUnique({ where: { tourId: tour.id } });
    expect(row?.status).toBe("failed");
    expect(row?.aiSummary).toBeNull();

    const destinations = new DestinationService(prisma as unknown as PrismaService);
    const result = await destinations.getByCountryAndCity(COUNTRY_SLUG, CITY_SLUG);
    expect(result.experiences[0].aiSummary).toBeNull();
  });

  it("leaves an existing TourCopy row untouched by a plain Tour-column update (AC-16, importer independence)", async () => {
    const experience = await makeExperience("T9");
    const tour = await makeTour("T9", { experienceId: experience.id });

    const generator = new FakeGenerator({
      kind: "text",
      text: "Copy that must survive a re-import.",
      usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    });
    await service(generator).generateOne(tour.id, { runId: "run_1", model: "claude-sonnet-5" });

    // Mirrors the shape of TourUpsertService.upsertBatch's update path: a
    // plain Tour-column write, touching nothing under `tourCopy`. The
    // importer never reads or writes TourCopy at all (AC-16); this proves
    // an ordinary re-import write can't clobber it either.
    await prisma.tour.update({
      where: { id: tour.id },
      data: { ratingCount: 21, deletedAt: null },
    });

    const row = await prisma.tourCopy.findUnique({ where: { tourId: tour.id } });
    expect(row?.status).toBe("published");
    expect(row?.aiSummary).toBe("Copy that must survive a re-import.");
  });
});
