import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { VERSION_NEUTRAL, VersioningType, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { experiencePageSchema, experienceRatingSchema } from "@folio/shared";

import { computeGroundingHash } from "../modules/content/tour-copy-grounding-hash";
import { PrismaService } from "../prisma/prisma.service";
import { EXPERIENCE_CACHE_CONTROL, ExperiencesController } from "./experiences.controller";
import { ExperiencesService, NOT_FOUND_DETAIL } from "./experiences.service";

/**
 * Integration tests for the tour page endpoints (spec 0005) against a **real
 * Postgres**, so the query itself is proven: the `deletedAt` filter, the id
 * ordering, BigInt and Json columns, and the TourCopy join. The CI `test` task
 * does not run this file (it needs a database); the unit twin that CI does run
 * is `experiences.http.spec.ts`.
 *
 * Hermetic: every fixture hangs off one fixture city and is scoped by
 * `provider: "experience-page-test"`, created before and removed after.
 * Refuses to run against the production database host.
 */

const DATABASE_URL = process.env.DATABASE_URL;
if (DATABASE_URL?.includes("lingering-wildflower")) {
  throw new Error("experiences.integration.spec must never run against the production database");
}
const prisma = new PrismaClient(DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined);

const PROVIDER = "experience-page-test";
const COUNTRY = "expageland";
const SLUG = "expagetown";

let cityId = "";
let app: INestApplication;
let baseUrl = "";

async function get(path: string): Promise<{ status: number; headers: Headers; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

interface TourSpec {
  id: string;
  exp: string;
  deleted?: boolean;
  title?: string;
  description?: string | null;
  ratingAvg?: number | null;
  ratingCount?: number | null;
  priceMinor?: bigint | null;
}

async function seed(experiences: Array<{ id: string; status?: string }>, tours: TourSpec[]): Promise<void> {
  await prisma.experience.createMany({
    data: experiences.map((e) => ({
      id: e.id,
      title: `Experience ${e.id}`,
      description: "fixture",
      status: e.status ?? "published",
      latitude: 1,
      longitude: 1,
      cityId,
      sourceProvider: PROVIDER,
      sourceProviderTourId: e.id,
    })),
  });
  await prisma.tour.createMany({
    data: tours.map((t) => ({
      id: t.id,
      provider: PROVIDER,
      providerTourId: t.id,
      title: t.title ?? `Tour ${t.id}`,
      description: t.description === undefined ? "Plain provider text." : t.description,
      durationMin: 90,
      ratingAvg: t.ratingAvg === undefined ? 4.5 : t.ratingAvg,
      ratingCount: t.ratingCount === undefined ? 50 : t.ratingCount,
      priceMinor: t.priceMinor === undefined ? 12_345_678_901n : t.priceMinor,
      currency: t.priceMinor === null ? null : "JPY",
      affiliateUrl: `https://www.viator.com/tours/x/${t.id}?pid=P1`,
      imageUrl: "https://img.test/plain.jpg",
      images: [
        {
          isCover: true,
          variants: [
            { url: `https://img.test/${t.id}-480.jpg`, width: 480, height: 320 },
            { url: `https://img.test/${t.id}-720.jpg`, width: 720, height: 480 },
          ],
        },
      ],
      cancellationPolicy: { type: "STANDARD", description: "Line one.\nLine two.", refundTiers: [] },
      experienceId: t.exp,
      deletedAt: t.deleted ? new Date() : null,
      fetchedAt: new Date(),
      sourceHash: "fixture",
    })),
  });
}

async function cleanup(): Promise<void> {
  // TourCopy rows cascade with their Tour.
  await prisma.tour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.experience.deleteMany({ where: { sourceProvider: PROVIDER } });
  await prisma.city.deleteMany({ where: { countrySlug: COUNTRY, slug: SLUG } });
}

beforeAll(async () => {
  await cleanup();
  const city = await prisma.city.create({
    data: {
      slug: SLUG,
      countrySlug: COUNTRY,
      name: "Expagetown",
      country: "Expageland",
      heroImageUrl: "https://img.test/hero.jpg",
      heroImageAlt: "hero",
    },
  });
  cityId = city.id;

  await seed(
    [
      { id: "ex-one" },
      { id: "ex-multi" },
      { id: "ex-draft", status: "draft" },
      { id: "ex-tourless" },
      { id: "ex-deleted" },
      { id: "ex-ai" },
      { id: "ex-stale" },
      { id: "ex-unrated" },
    ],
    [
      { id: "t-one", exp: "ex-one", title: "Single Tour" },
      // Lowest id is soft deleted, so the live lowest id is t-multi-b.
      { id: "t-multi-a", exp: "ex-multi", deleted: true },
      { id: "t-multi-c", exp: "ex-multi", title: "C" },
      { id: "t-multi-b", exp: "ex-multi", title: "B", ratingAvg: 4.2, ratingCount: 21 },
      { id: "t-draft", exp: "ex-draft" },
      { id: "t-deleted", exp: "ex-deleted", deleted: true },
      { id: "t-ai", exp: "ex-ai", description: "Original description." },
      { id: "t-stale", exp: "ex-stale", description: "Edited description." },
      { id: "t-unrated", exp: "ex-unrated", ratingAvg: null, ratingCount: null, priceMinor: null },
    ],
  );

  const grounding = (description: string) =>
    computeGroundingHash({ title: "Tour t-ai", description, durationMin: 90, inclusions: [], exclusions: [] });
  const copy = (tourId: string, groundingHash: string) => ({
    tourId,
    status: "published" as const,
    aiSummary: "Written for Atlas.",
    groundingHash,
    model: "fixture",
    promptVersion: 1,
    generatedAt: new Date(),
    attempts: 1,
    runId: "fixture-run",
  });
  await prisma.tourCopy.create({ data: copy("t-ai", grounding("Original description.")) });
  // Hash computed from the old description, so it no longer matches the tour.
  await prisma.tourCopy.create({
    data: { ...copy("t-stale", grounding("Original description.")), aiSummary: "Stale copy." },
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [ExperiencesController],
    providers: [ExperiencesService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  app = moduleRef.createNestApplication();
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: VERSION_NEUTRAL });
  await app.listen(0);
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
});

afterAll(async () => {
  await app?.close();
  await cleanup();
  await prisma.$disconnect();
});

describe("GET /v1/experiences/:id against Postgres", () => {
  it("returns the page data for a published Experience with a live Tour (AC-1, AC-3)", async () => {
    const res = await get("/v1/experiences/ex-one");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(EXPERIENCE_CACHE_CONTROL);
    expect(experiencePageSchema.parse(res.body)).toEqual({
      experienceId: "ex-one",
      tourId: "t-one",
      title: "Single Tour",
      image: { url: "https://img.test/t-one-720.jpg", width: 720, height: 480, alt: "Single Tour" },
      durationMin: 90,
      // Above 2^31: the BigInt column reaches JSON as an exact number.
      price: { amountMinor: 12345678901, currency: "JPY" },
      cancellationDescription: "Line one.\nLine two.",
      summary: { kind: "provider", text: "Plain provider text." },
      affiliateUrl: "https://www.viator.com/tours/x/t-one?pid=P1",
      city: { slug: SLUG, countrySlug: COUNTRY, name: "Expagetown" },
    });
  });

  it("picks the live Tour with the lowest id, in the database's own ordering (AC-1, AC-2)", async () => {
    const page = experiencePageSchema.parse((await get("/v1/experiences/ex-multi")).body);
    expect(page.tourId).toBe("t-multi-b");
    const rating = experienceRatingSchema.parse((await get("/v1/experiences/ex-multi/rating")).body);
    expect(rating).toEqual({ ratingAvg: 4.2, ratingCount: 21 });
  });

  it("has a null price and unrated nulls for a Tour with neither (AC-1, AC-2)", async () => {
    expect(experiencePageSchema.parse((await get("/v1/experiences/ex-unrated")).body).price).toBeNull();
    expect((await get("/v1/experiences/ex-unrated/rating")).body).toEqual({ ratingAvg: null, ratingCount: null });
  });

  it("serves the AI copy only while its grounding hash is current (AC-5)", async () => {
    expect(experiencePageSchema.parse((await get("/v1/experiences/ex-ai")).body).summary).toEqual({
      kind: "ai",
      text: "Written for Atlas.",
    });
    expect(experiencePageSchema.parse((await get("/v1/experiences/ex-stale")).body).summary).toEqual({
      kind: "provider",
      text: "Edited description.",
    });
  });

  it.each([
    ["an unknown id", "ex-nope", NOT_FOUND_DETAIL.unknown],
    ["a draft Experience", "ex-draft", NOT_FOUND_DETAIL.unpublished],
    ["an Experience with no Tour", "ex-tourless", NOT_FOUND_DETAIL.noLiveTour],
    ["an Experience whose only Tour is soft deleted", "ex-deleted", NOT_FOUND_DETAIL.noLiveTour],
  ])("404s for %s with its own detail and the cache header, on both endpoints (AC-3)", async (_name, id, detail) => {
    for (const path of [`/v1/experiences/${id}`, `/v1/experiences/${id}/rating`]) {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      expect(res.headers.get("cache-control")).toBe(EXPERIENCE_CACHE_CONTROL);
      expect(res.body).toMatchObject({ status: 404, detail });
    }
  });
});
