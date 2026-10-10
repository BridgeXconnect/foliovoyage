import { describe, expect, it } from "@jest/globals";

import { CategoryResolver } from "./category-resolver";
import type { TourDTO } from "./normalizer";
import type { TagVocabulary } from "./tag-resolver";
import { TourUpsertService, type TourUpsertPrisma } from "./upsert";

/**
 * BRI-249: `upsertBatch` must write `Tour.primaryCategoryTagId` on both the
 * create and the update path. The pipeline specs stub the category resolver and
 * the store, so nothing before this exercised the real hand-off from the DTO to
 * the Prisma call. Runs in the default jest run (no database): the fake
 * `tour.upsert` mimics Prisma's create/update split, including that an
 * `undefined` field in `update` is left untouched.
 */

const FOOD_AND_DRINK = 21911;
const TOURS_SIGHTSEEING = 21913;

type Row = Record<string, unknown>;
interface UpsertArgs {
  where: { provider_providerTourId: { provider: string; providerTourId: string } };
  create: Row;
  update: Row;
}

function fakePrisma(seed: Row[] = []) {
  const rows = new Map<string, Row>(
    seed.map((r) => [r.providerTourId as string, r]),
  );
  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        tour: {
          upsert: async (args: UpsertArgs) => {
            const id = args.where.provider_providerTourId.providerTourId;
            const existing = rows.get(id);
            if (!existing) {
              rows.set(id, { ...args.create });
              return;
            }
            const next = { ...existing };
            for (const [key, value] of Object.entries(args.update)) {
              if (value !== undefined) next[key] = value;
            }
            rows.set(id, next);
          },
        },
      }),
  } as unknown as TourUpsertPrisma;
  return { prisma, rows };
}

function makeTour(id: string, overrides: Partial<TourDTO> = {}): TourDTO {
  return {
    provider: "viator",
    provider_tour_id: id,
    title: `Tour ${id}`,
    description: "A tour.",
    duration_min: 120,
    rating_avg: 4.5,
    rating_count: 100,
    price_minor: 2500,
    currency: "USD",
    price_reference_minor: null,
    price_reference_currency: null,
    affiliate_url: `https://www.viator.com/tours/${id}`,
    location_ref: "LOC-abc123",
    latitude: 21.03,
    longitude: 105.85,
    image_url: null,
    image_alt: null,
    destination_refs: ["351"],
    tags: [],
    primary_category_tag_id: null,
    images: [],
    inclusions: [],
    exclusions: [],
    cancellation_policy: null,
    reviews_by_source: [],
    fetched_at: "2026-10-10T00:00:00.000Z",
    source_hash: `hash-${id}`,
    ...overrides,
  };
}

const category = (rows: Map<string, Row>, id: string) =>
  rows.get(id)?.primaryCategoryTagId;

describe("TourUpsertService.upsertBatch — primaryCategoryTagId", () => {
  it("writes the DTO's category when it creates a tour", async () => {
    const { prisma, rows } = fakePrisma();
    await new TourUpsertService(prisma).upsertBatch([
      makeTour("a", { primary_category_tag_id: FOOD_AND_DRINK }),
    ]);
    expect(category(rows, "a")).toBe(FOOD_AND_DRINK);
  });

  it("writes null on create when the DTO has no category", async () => {
    const { prisma, rows } = fakePrisma();
    await new TourUpsertService(prisma).upsertBatch([makeTour("a")]);
    expect(category(rows, "a")).toBeNull();
  });

  it("fills a null category on an existing tour", async () => {
    const { prisma, rows } = fakePrisma([
      { providerTourId: "a", primaryCategoryTagId: null },
    ]);
    await new TourUpsertService(prisma).upsertBatch([
      makeTour("a", { primary_category_tag_id: FOOD_AND_DRINK }),
    ]);
    expect(category(rows, "a")).toBe(FOOD_AND_DRINK);
  });

  it("replaces an existing category with a different derived one", async () => {
    const { prisma, rows } = fakePrisma([
      { providerTourId: "a", primaryCategoryTagId: TOURS_SIGHTSEEING },
    ]);
    await new TourUpsertService(prisma).upsertBatch([
      makeTour("a", { primary_category_tag_id: FOOD_AND_DRINK }),
    ]);
    expect(category(rows, "a")).toBe(FOOD_AND_DRINK);
  });

  it("does not overwrite an existing category with a null DTO value", async () => {
    const { prisma, rows } = fakePrisma([
      { providerTourId: "a", primaryCategoryTagId: FOOD_AND_DRINK },
    ]);
    await new TourUpsertService(prisma).upsertBatch([makeTour("a")]);
    expect(category(rows, "a")).toBe(FOOD_AND_DRINK);
  });
});

describe("upsertBatch fed by the real CategoryResolver", () => {
  const vocabulary = (graph: [number, number[]][]): TagVocabulary => ({
    graph: new Map(graph),
    names: new Map(),
  });
  const resolverFor = (v: TagVocabulary) =>
    new CategoryResolver({ getVocabulary: async () => v }, { warn: () => {} });

  it("persists the derived category end to end", async () => {
    const { prisma, rows } = fakePrisma();
    const resolver = resolverFor(
      vocabulary([
        [FOOD_AND_DRINK, []],
        [100, [FOOD_AND_DRINK]],
      ]),
    );
    const attached = await resolver.attachCategories([makeTour("a", { tags: [100] })]);
    await new TourUpsertService(prisma).upsertBatch(attached);
    expect(category(rows, "a")).toBe(FOOD_AND_DRINK);
  });

  it("keeps an existing category when the vocabulary came back empty", async () => {
    // TagResolver returns an empty vocabulary (no throw) when the fetch fails
    // and the cache is empty; the resolver then yields null for every tour.
    const { prisma, rows } = fakePrisma([
      { providerTourId: "a", primaryCategoryTagId: FOOD_AND_DRINK },
    ]);
    const attached = await resolverFor(vocabulary([])).attachCategories([
      makeTour("a", { tags: [100] }),
    ]);
    expect(attached[0].primary_category_tag_id).toBeNull();
    await new TourUpsertService(prisma).upsertBatch(attached);
    expect(category(rows, "a")).toBe(FOOD_AND_DRINK);
  });
});
