import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { VERSION_NEUTRAL, VersioningType, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import {
  CANVAS_CATEGORIES,
  canvasBucketResponseSchema,
  canvasBucketsResponseSchema,
  type CanvasBucketResponse,
} from "@folio/shared";

import { PrismaService } from "../prisma/prisma.service";
import { CANVAS_CACHE_CONTROL, CanvasController } from "./canvas.controller";
import { CACHE_TTL_MS, CANVAS_FEED_CITIES, CanvasService, MAX_TILES } from "./canvas.service";

/**
 * Integration tests for the canvas feed (BRI-225) against a **real Postgres**:
 * the ranking is SQL (window functions, `COLLATE "C"`, JSON unnesting), so a
 * fake could not stand in for it.
 *
 * Hermetic by construction. Every fixture hangs off one fixture city
 * (`canvasland/canvastown`) and the service is told to serve only that city, so
 * the assertions do not depend on what else the database holds, including a
 * fully linked and promoted dev catalogue. Fixtures are scoped by
 * `provider: "canvas-test"` and removed before and after.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const prisma = new PrismaClient(
  DATABASE_URL ? { datasources: { db: { url: DATABASE_URL } } } : undefined,
);

const PROVIDER = "canvas-test";
const COUNTRY = "canvasland";
const SLUG = "canvastown";
const FIXTURE_CITY = { slug: SLUG, countrySlug: COUNTRY };

// Category tag ids used as buckets.
const OUTDOOR = 21909; // ranking, Bayesian prior, unrated order, exclusions
const ART = 21910; // one tile per Experience
const FOOD = 21911; // the tile cap and the image pick by rank
const TICKETS = 21912; // no rated tour at all, large price
const TOURS = 21913; // image fallbacks
const CLASSES = 21915; // only ineligible tours, so an empty bucket
const EXCLUDED = 21914;

const M = 10;

let queries = 0;
const sqlLog: string[] = [];
const countingPrisma = {
  $queryRaw: (...args: unknown[]) => {
    queries += 1;
    sqlLog.push((args[0] as { sql: string }).sql);
    return (prisma.$queryRaw as (...a: unknown[]) => unknown)(...args);
  },
} as unknown as PrismaService;

function freshService(): CanvasService {
  return new CanvasService(countingPrisma, [FIXTURE_CITY]);
}

let cityId = "";

interface TourSpec {
  id: string;
  /** Experience id. Defaults to one Experience per tour. */
  exp?: string;
  cat: number | null;
  rating?: number | null;
  count?: number | null;
  price?: bigint | null;
  currency?: string | null;
  imageUrl?: string | null;
  images?: unknown;
  deleted?: boolean;
  /** Experience status. Defaults to published. */
  status?: string;
  title?: string;
  durationMin?: number | null;
}

const sizedImages = (u: string) => [
  {
    isCover: true,
    variants: [
      { url: `${u}-480.jpg`, width: 480, height: 320 },
      { url: `${u}-720.jpg`, width: 720, height: 480 },
    ],
  },
];

async function seedTours(specs: TourSpec[]): Promise<void> {
  const exps = new Map<string, string>();
  for (const s of specs) exps.set(s.exp ?? `exp-${s.id}`, s.status ?? "published");
  await prisma.experience.createMany({
    data: [...exps].map(([id, status]) => ({
      id,
      title: id,
      description: "fixture",
      status,
      latitude: 1,
      longitude: 1,
      cityId,
      sourceProvider: PROVIDER,
      sourceProviderTourId: id,
    })),
  });
  await prisma.tour.createMany({
    data: specs.map((s) => ({
      id: s.id,
      provider: PROVIDER,
      providerTourId: s.id,
      title: s.title ?? `Tour ${s.id}`,
      durationMin: s.durationMin ?? 120,
      ratingAvg: s.rating ?? null,
      ratingCount: s.count ?? null,
      priceReferenceMinor: s.price === undefined ? 5000n : s.price,
      priceReferenceCurrency: s.currency === undefined ? "USD" : s.currency,
      imageUrl: s.imageUrl === undefined ? null : s.imageUrl,
      images: (s.images === undefined ? sizedImages(`https://img.test/${s.id}`) : s.images) as never,
      primaryCategoryTagId: s.cat,
      experienceId: s.exp ?? `exp-${s.id}`,
      deletedAt: s.deleted ? new Date() : null,
      fetchedAt: new Date(),
      sourceHash: "fixture",
    })),
  });
}

async function cleanup(): Promise<void> {
  await prisma.tour.deleteMany({ where: { provider: PROVIDER } });
  await prisma.experience.deleteMany({ where: { sourceProvider: PROVIDER } });
  await prisma.city.deleteMany({ where: { countrySlug: COUNTRY, slug: SLUG } });
}

/** The Bayesian score of AC-F5, written out independently of the SQL. */
const bayes = (r: number, v: number, c: number): number => (v / (v + M)) * r + (M / (v + M)) * c;

let app: INestApplication;
let baseUrl = "";

async function get(path: string): Promise<{ status: number; headers: Headers; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  await cleanup();
  const city = await prisma.city.create({
    data: {
      slug: SLUG,
      countrySlug: COUNTRY,
      name: "Canvastown",
      country: "Canvasland",
      heroImageUrl: "https://img.test/hero.jpg",
      heroImageAlt: "hero",
    },
  });
  cityId = city.id;

  // OUTDOOR. Rated tours A, B, X1, X2 (X1 and X2 share Experience X); the prior
  // C is 3.6 over all four, but would be 4.4667 if the dropped X2 were left out,
  // and that flips B ahead of A. Unrated tours rank last, ordered on id with
  // COLLATE "C" (uppercase before lowercase, unlike an en_US collation). Decoys
  // each break one eligibility rule.
  await seedTours([
    { id: "A", cat: OUTDOOR, rating: 4.0, count: 40 },
    { id: "B", cat: OUTDOOR, rating: 4.5, count: 4 },
    { id: "X1", exp: "exp-X", cat: OUTDOOR, rating: 4.9, count: 100 },
    { id: "X2", exp: "exp-X", cat: OUTDOOR, rating: 1.0, count: 100 },
    { id: "unrated-a", cat: OUTDOOR },
    { id: "Unrated-B", cat: OUTDOOR },
    { id: "unrated-zero", cat: OUTDOOR, rating: 4.9, count: 0 },
    { id: "unrated-nullcount", cat: OUTDOOR, rating: 4.9, count: null },
    { id: "decoy-deleted", cat: OUTDOOR, rating: 5.0, count: 500, deleted: true },
    { id: "decoy-noprice", cat: OUTDOOR, rating: 5.0, count: 500, price: null },
    { id: "decoy-noimage", cat: OUTDOOR, rating: 5.0, count: 500, images: [] },
    { id: "decoy-emptyurl", cat: OUTDOOR, rating: 5.0, count: 500, imageUrl: "", images: [] },
    { id: "decoy-draft", cat: OUTDOOR, rating: 5.0, count: 500, status: "draft" },
    { id: "decoy-21914", cat: EXCLUDED, rating: 5.0, count: 500 },
    { id: "decoy-nullcat", cat: null, rating: 5.0, count: 500 },
  ]);

  // ART. Two tours in one Experience give one tile. E1: equal scores, the lower
  // id wins. E2: the better score wins although it has the higher id. E3: a
  // rated tour beats an unrated one.
  await seedTours([
    { id: "tie-b", exp: "exp-E1", cat: ART, rating: 4.0, count: 20 },
    { id: "tie-a", exp: "exp-E1", cat: ART, rating: 4.0, count: 20 },
    { id: "z-better", exp: "exp-E2", cat: ART, rating: 4.2, count: 50 },
    { id: "a-worse", exp: "exp-E2", cat: ART, rating: 3.0, count: 50 },
    { id: "m-unrated", exp: "exp-E3", cat: ART },
    { id: "n-rated", exp: "exp-E3", cat: ART, rating: 2.0, count: 3 },
  ]);

  // FOOD. 65 Experiences, one tour each: only MAX_TILES tiles come back, total says 65.
  await seedTours(
    Array.from({ length: 65 }, (_, i) => ({
      id: `f${String(i).padStart(2, "0")}`,
      cat: FOOD,
      rating: 3 + (i % 20) / 10,
      count: 5 + ((i * 7) % 50),
    })),
  );

  // TICKETS. No rated tour at all, so every tour is unrated and ordered on id.
  // One price is above 2^31 to prove the BigInt reaches JSON as an exact number;
  // one has no currency, which falls back to the column default.
  await seedTours([
    { id: "t-c", cat: TICKETS, price: 12_345_678_901n },
    { id: "t-B", cat: TICKETS, currency: null },
    { id: "t-a", cat: TICKETS, currency: "EUR" },
  ]);

  // TOURS. Image fallbacks: only imageUrl; a width 0 variant next to imageUrl;
  // a tour with neither is not eligible.
  await seedTours([
    {
      id: "img-plain",
      cat: TOURS,
      rating: 4.0,
      count: 10,
      images: [],
      imageUrl: "https://img.test/plain.jpg",
    },
    {
      id: "img-zero",
      cat: TOURS,
      rating: 3.0,
      count: 10,
      images: [{ isCover: true, variants: [{ url: "https://img.test/zero.jpg", width: 0, height: 0 }] }],
      imageUrl: "https://img.test/zero-fallback.jpg",
    },
    { id: "img-none", cat: TOURS, rating: 5.0, count: 100, images: [], imageUrl: null },
  ]);

  // CLASSES. Valid slugs, but nothing eligible: an empty bucket.
  await seedTours([
    { id: "cl-noprice", cat: CLASSES, rating: 4.0, count: 10, price: null },
    { id: "cl-deleted", cat: CLASSES, rating: 4.0, count: 10, deleted: true },
  ]);

  const moduleRef = await Test.createTestingModule({
    controllers: [CanvasController],
    providers: [
      CanvasService,
      { provide: CANVAS_FEED_CITIES, useValue: [FIXTURE_CITY] },
      { provide: PrismaService, useValue: countingPrisma },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: VERSION_NEUTRAL });
  await app.listen(0);
  const address = app.getHttpServer().address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app?.close();
  await cleanup();
  await prisma.$disconnect();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /v1/canvas/buckets/:citySlug/:categorySlug", () => {
  it("returns tiles in Bayesian order with ranks 1 to N (AC-F2, AC-F5)", async () => {
    const { status, body } = await get(`/v1/canvas/buckets/${SLUG}/outdoor-activities`);
    expect(status).toBe(200);
    const bucket = body as CanvasBucketResponse;

    // C over the four rated tours, X2 included, before one tile per Experience.
    const c = (4.0 + 4.5 + 4.9 + 1.0) / 4;
    const ranked = [
      { tourId: "X1", score: bayes(4.9, 100, c) },
      { tourId: "A", score: bayes(4.0, 40, c) },
      { tourId: "B", score: bayes(4.5, 4, c) },
    ].sort((p, q) => q.score - p.score);
    const ratedIds = ranked.map((r) => r.tourId);
    expect(ratedIds).toEqual(["X1", "A", "B"]);

    // Leaving the dropped tour out of C would reorder A and B: the test can fail.
    const cWithoutDropped = (4.0 + 4.5 + 4.9) / 3;
    expect(bayes(4.5, 4, cWithoutDropped)).toBeGreaterThan(bayes(4.0, 40, cWithoutDropped));

    const ids = bucket.tiles.map((t) => t.tourId);
    expect(ids.slice(0, 3)).toEqual(ratedIds);
    expect(bucket.tiles.map((t) => t.rank)).toEqual(ids.map((_, i) => i + 1));
  });

  it("ranks unrated tours after every rated one, on Tour id with COLLATE C (AC-F5)", async () => {
    const { body } = await get(`/v1/canvas/buckets/${SLUG}/outdoor-activities`);
    const ids = (body as CanvasBucketResponse).tiles.map((t) => t.tourId);
    // ratingAvg without a ratingCount, or with a zero one, is unrated.
    expect(ids.slice(3)).toEqual(["Unrated-B", "unrated-a", "unrated-nullcount", "unrated-zero"]);
  });

  it("leaves out deleted, unpriced, imageless, draft, 21914 and null category tours (AC-F3)", async () => {
    const { body } = await get(`/v1/canvas/buckets/${SLUG}/outdoor-activities`);
    const bucket = body as CanvasBucketResponse;
    const ids = bucket.tiles.map((t) => t.tourId);
    expect(ids.filter((id) => id.startsWith("decoy"))).toEqual([]);
    expect(bucket.total).toBe(7); // A, B, X, four unrated
    expect(bucket.tiles).toHaveLength(7);

    // No bucket anywhere contains the 21914 or null category tour.
    const everything = await Promise.all(
      CANVAS_CATEGORIES.map((c) => get(`/v1/canvas/buckets/${SLUG}/${c.slug}`)),
    );
    const all = everything
      .filter((r) => r.status === 200)
      .flatMap((r) => (r.body as CanvasBucketResponse).tiles.map((t) => t.tourId));
    expect(all).not.toContain("decoy-21914");
    expect(all).not.toContain("decoy-nullcat");
  });

  it("gives one tile per Experience: the better tour, ties on the lowest id (AC-F4)", async () => {
    const { body } = await get(`/v1/canvas/buckets/${SLUG}/art-culture`);
    const bucket = body as CanvasBucketResponse;
    const byExperience = new Map(bucket.tiles.map((t) => [t.id, t.tourId]));
    expect(bucket.tiles).toHaveLength(3);
    expect(byExperience.get("exp-E1")).toBe("tie-a");
    expect(byExperience.get("exp-E2")).toBe("z-better");
    expect(byExperience.get("exp-E3")).toBe("n-rated");
    expect(new Set(bucket.tiles.map((t) => t.id)).size).toBe(bucket.tiles.length);
    expect(bucket.total).toBe(3);
  });

  it("orders a bucket with no rated tour on Tour id, and sends a big price as an exact number (AC-F5, AC-F6)", async () => {
    const { body } = await get(`/v1/canvas/buckets/${SLUG}/tickets-passes`);
    const bucket = body as CanvasBucketResponse;
    expect(bucket.tiles.map((t) => t.tourId)).toEqual(["t-B", "t-a", "t-c"]);
    expect(bucket.tiles.map((t) => t.price)).toEqual([
      { amountMinor: 5000, currency: "USD" }, // no currency: the column default
      { amountMinor: 5000, currency: "EUR" },
      { amountMinor: 12_345_678_901, currency: "USD" },
    ]);
    expect(bucket.tiles[0]).toMatchObject({ ratingAvg: null, ratingCount: null, durationMin: 120 });
  });

  it("caps a bucket at the tile cap but reports the true total, and ranks all of them in order (AC-F2, AC-F5)", async () => {
    const { body } = await get(`/v1/canvas/buckets/${SLUG}/food-drink`);
    const bucket = body as CanvasBucketResponse;
    expect(MAX_TILES).toBe(50);
    expect(bucket.tiles).toHaveLength(MAX_TILES);
    expect(bucket.total).toBe(65);

    const rows = Array.from({ length: 65 }, (_, i) => ({
      tourId: `f${String(i).padStart(2, "0")}`,
      r: 3 + (i % 20) / 10,
      v: 5 + ((i * 7) % 50),
    }));
    const c = rows.reduce((sum, row) => sum + row.r, 0) / rows.length;
    const expected = rows
      .map((row) => ({ tourId: row.tourId, score: bayes(row.r, row.v, c) }))
      .sort((p, q) => q.score - p.score || (p.tourId < q.tourId ? -1 : 1))
      .slice(0, MAX_TILES)
      .map((row) => row.tourId);
    expect(bucket.tiles.map((t) => t.tourId)).toEqual(expected);
  });

  it("picks the image by rank: 640 wide for the top tiles, 480 for sm ranks (AC-F7)", async () => {
    const { body } = await get(`/v1/canvas/buckets/${SLUG}/food-drink`);
    const tiles = (body as CanvasBucketResponse).tiles;
    expect(tiles[0]!.image).toMatchObject({ width: 720, height: 480 });
    expect(tiles[19]!.image.width).toBe(720); // rank 20, md
    expect(tiles[20]!.image.width).toBe(480); // rank 21, sm
    expect(tiles[MAX_TILES - 1]!.image.width).toBe(480);
  });

  it("falls back to imageUrl, and treats a width 0 variant as unknown (AC-F7)", async () => {
    const { body } = await get(`/v1/canvas/buckets/${SLUG}/tours-sightseeing`);
    const bucket = body as CanvasBucketResponse;
    expect(bucket.tiles.map((t) => t.tourId)).toEqual(["img-plain", "img-zero"]); // img-none is not eligible
    expect(bucket.tiles[0]!.image).toEqual({ url: "https://img.test/plain.jpg", width: null, height: null });
    expect(bucket.tiles[1]!.image).toEqual({
      url: "https://img.test/zero-fallback.jpg",
      width: null,
      height: null,
    });
  });

  it("returns 404 problem+json for an unknown city, an unknown category and an empty bucket (AC-F2)", async () => {
    for (const path of [
      `/v1/canvas/buckets/atlantis/outdoor-activities`,
      `/v1/canvas/buckets/${SLUG}/travel-transportation`, // 21914 has no slug
      `/v1/canvas/buckets/${SLUG}/classes-workshops`, // valid slugs, nothing eligible
      `/v1/canvas/buckets/${SLUG}/seasonal-events`, // valid slugs, no tours at all
    ]) {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      expect(res.headers.get("cache-control")).toBeNull();
      expect(await res.json()).toMatchObject({ status: 404, instance: path });
    }
  });

  it("carries the cache header and parses against the shared schema (AC-F8, AC-F9)", async () => {
    const { headers, body } = await get(`/v1/canvas/buckets/${SLUG}/food-drink`);
    expect(headers.get("cache-control")).toBe(CANVAS_CACHE_CONTROL);
    const parsed = canvasBucketResponseSchema.parse(body);
    expect(parsed.cityName).toBe("Canvastown");
    expect(parsed.categoryLabel).toBe("Food & Drink");
    expect(parsed.image).toEqual(parsed.tiles[0]!.image);
    for (const tile of parsed.tiles) {
      expect(Object.keys(tile).sort()).toEqual(
        ["durationMin", "id", "image", "price", "ratingAvg", "ratingCount", "rank", "title", "tourId"].sort(),
      );
    }
  });
});

describe("GET /v1/canvas/buckets", () => {
  it("returns one summary per non empty bucket, in world order, parsing against the schema (AC-F1, AC-F9)", async () => {
    const { headers, body } = await get(`/v1/canvas/buckets`);
    expect(headers.get("cache-control")).toBe(CANVAS_CACHE_CONTROL);
    const { buckets } = canvasBucketsResponseSchema.parse(body);

    // Classes and seasonal are empty and left out; the rest follow category order.
    expect(buckets.map((b) => b.categorySlug)).toEqual([
      "outdoor-activities",
      "art-culture",
      "food-drink",
      "tickets-passes",
      "tours-sightseeing",
    ]);
    expect(buckets.map((b) => b.total)).toEqual([7, 3, 65, 3, 2]);
    expect(buckets[0]).toMatchObject({
      citySlug: SLUG,
      countrySlug: COUNTRY,
      cityName: "Canvastown",
      categoryLabel: "Outdoor Activities",
    });
  });

  it("uses each bucket's rank 1 tile for the summary picture (AC-F1)", async () => {
    const { body } = await get(`/v1/canvas/buckets`);
    const { buckets } = canvasBucketsResponseSchema.parse(body);
    for (const summary of buckets) {
      const { body: bucket } = await get(`/v1/canvas/buckets/${summary.citySlug}/${summary.categorySlug}`);
      expect(summary.image).toEqual((bucket as CanvasBucketResponse).tiles[0]!.image);
    }
  });
});

describe("cost and cache (AC-F8, AC-F10)", () => {
  it("runs one query per bucket request and one grouped query for the summaries", async () => {
    const service = freshService();
    queries = 0;
    await service.getBucket(SLUG, "food-drink");
    expect(queries).toBe(1);

    queries = 0;
    const { buckets } = await service.getSummaries();
    expect(buckets.length).toBeGreaterThan(1);
    expect(queries).toBe(1); // not one per bucket
  });

  it("does not hit the database for a repeat request inside 10 minutes, then refreshes", async () => {
    const service = freshService();
    const start = Date.now();
    const now = jest.spyOn(Date, "now").mockReturnValue(start);

    queries = 0;
    const first = await service.getBucket(SLUG, "art-culture");
    const second = await service.getBucket(SLUG, "art-culture");
    const summaries1 = await service.getSummaries();
    const summaries2 = await service.getSummaries();
    expect(queries).toBe(2); // one bucket, one summaries
    expect(second).toBe(first);
    expect(summaries2).toBe(summaries1);

    now.mockReturnValue(start + CACHE_TTL_MS - 1);
    await service.getBucket(SLUG, "art-culture");
    expect(queries).toBe(2);

    now.mockReturnValue(start + CACHE_TTL_MS + 1);
    await service.getBucket(SLUG, "art-culture");
    expect(queries).toBe(3);
  });

  // The default collation of some databases (Neon's C.UTF-8 among them) already
  // orders ASCII ids like "C", so the data cannot prove the clause there. This
  // pins it in the statement itself, for databases whose default is a locale.
  it('orders on Tour id with COLLATE "C" in the per Experience pick and in the ranking', async () => {
    const service = freshService();
    sqlLog.length = 0;
    await service.getBucket(SLUG, "art-culture");
    await service.getSummaries();
    expect(sqlLog).toHaveLength(2);
    for (const sql of sqlLog) {
      expect(sql.match(/tour_id COLLATE "C" ASC/g)).toHaveLength(2);
    }
  });

  it("runs one query for concurrent first requests", async () => {
    const service = freshService();
    queries = 0;
    await Promise.all([service.getBucket(SLUG, "food-drink"), service.getBucket(SLUG, "food-drink")]);
    expect(queries).toBe(1);
  });

  it("does not run a query for an unknown slug", async () => {
    const service = freshService();
    queries = 0;
    await expect(service.getBucket("atlantis", "food-drink")).rejects.toThrow();
    await expect(service.getBucket(SLUG, "nope")).rejects.toThrow();
    expect(queries).toBe(0);
  });
});

describe("category map against the vocabulary", () => {
  it("every root tag id in the shared category map exists in ViatorTag", async () => {
    const ids = CANVAS_CATEGORIES.map((c) => c.tagId);
    const found = await prisma.viatorTag.findMany({
      where: { tagId: { in: [...ids, EXCLUDED] } },
      select: { tagId: true },
    });
    const present = new Set(found.map((t) => t.tagId));
    expect(ids.filter((id) => !present.has(id))).toEqual([]);
  });
});
