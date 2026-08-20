import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { ViatorClient, ViatorPage } from "./clients/viator.client";
import type { ViatorProduct } from "./clients/viator.types";
import type { LocationResolver } from "./location-resolver";
import { ImportPipeline, ImportRunCounts } from "./import.pipeline";
import type { TourDTO } from "./normalizer";
import type { PriceResolver } from "./price-resolver";
import { type TourUpsertService, type UpsertBatchResult } from "./upsert";
import {
  TourValidator,
  type QuarantineRecord,
  type QuarantineStore,
} from "./validator";

/**
 * Unit tests for {@link ImportPipeline} (ST-10 / BRI-107, restructured by
 * BRI-170, bounded to one segment per call by BRI-176).
 *
 * These prove the orchestration contract without a DB or network: stages are
 * threaded in order **per page** (BRI-170: geo-resolve/price-resolve/validate/
 * upsert now happen inside the page loop, not after it, so at most one page's
 * curated survivors are ever held as full `TourDTO` objects), the
 * caller-owned {@link ImportRunCounts} reflects each stage's tally *even when
 * a later stage throws*, and (BRI-176) `runSegment` stops after
 * `restartEveryNPages` pages, reporting `done`/the resume cursor correctly —
 * it does **not** call `finalizeGuardedSoftDelete` or `ExperienceLinker`
 * itself any more (those moved to `segment-worker.cli.ts`, since they must
 * run once per *run*, not once per *segment*).
 */

const FETCHED_AT = "2026-08-20T00:00:00.000Z";

/**
 * A raw Viator product that survives the BRI-170/171 scope filter (curated
 * destination, ACTIVE, instant confirmation) and the normalizer will accept.
 * No price: a real product payload carries none (BRI-165) — price is attached
 * later by the price resolver, faked below.
 */
function rawProduct(code: string, overrides: Record<string, unknown> = {}): ViatorProduct {
  return {
    productCode: code,
    title: `Tour ${code}`,
    status: "ACTIVE",
    destinations: [{ ref: "343", primary: true }], // Bangkok — a curated ref
    bookingConfirmationSettings: { confirmationType: "INSTANT" },
    ...overrides,
  };
}

/** A client that yields the given products across one or more pages. */
function fakeClient(pages: ViatorProduct[][]): ViatorClient {
  return {
    async *fetchModifiedSince(): AsyncGenerator<ViatorPage> {
      for (let i = 0; i < pages.length; i += 1) {
        yield {
          page: i + 1,
          products: pages[i],
          nextCursor: i < pages.length - 1 ? `cursor-${i + 1}` : undefined,
          archive: { bucket: "b", key: `k-${i}` },
        };
      }
    },
  } as unknown as ViatorClient;
}

/**
 * `restartEveryNPages` for every existing test in this file that isn't
 * exercising segment-bounding itself (BRI-176) — large enough that no
 * fixture here (at most a few hundred products across a handful of pages)
 * ever stops a segment early.
 */
const NEVER_STOPS_EARLY = 1000;

/**
 * A client whose `fetchModifiedSince` is a `jest.fn` (BRI-176), so
 * segment-bounding tests can assert on its call arguments. Resumes from
 * `startPage` (mirroring how the real `ViatorClient.fetchModifiedSince` uses
 * it to keep page numbers continuous across a resumed segment — see
 * `viator.client.ts`); `startCursor` is recorded, not used to index, since
 * this fake's "cursor" values are just page-position markers.
 */
function fakeResumableClient(pages: ViatorProduct[][]): {
  client: ViatorClient;
  calls: Array<{ startCursor?: string; startPage?: number }>;
} {
  const calls: Array<{ startCursor?: string; startPage?: number }> = [];
  const fetchModifiedSince = jest.fn(
    (options: { startCursor?: string; startPage?: number } = {}) => {
      calls.push({
        startCursor: options.startCursor,
        startPage: options.startPage,
      });
      const startIndex = options.startPage ?? 0;
      return (async function* (): AsyncGenerator<ViatorPage> {
        for (let i = startIndex; i < pages.length; i += 1) {
          yield {
            page: i + 1,
            products: pages[i],
            nextCursor: i < pages.length - 1 ? `cursor-${i + 1}` : undefined,
            archive: { bucket: "b", key: `k-${i}` },
          };
        }
      })();
    },
  );
  return { client: { fetchModifiedSince } as unknown as ViatorClient, calls };
}

/** A resolver that leaves coordinates untouched (pass-through). */
const passthroughResolver = {
  attachLocations: async (tours: TourDTO[]): Promise<TourDTO[]> =>
    tours.map((t) => ({ ...t })),
} as unknown as LocationResolver;

/**
 * A price resolver fake. By default it attaches a valid positive price to every
 * tour (so the real validator passes them). Pass `priceFor` to control the price
 * per product code — return `null` to leave a tour unpriced (→ quarantined).
 */
function fakePriceResolver(
  priceFor: (code: string) => number | null = () => 2500,
): PriceResolver {
  return {
    attachPrices: async (tours: TourDTO[]): Promise<TourDTO[]> =>
      tours.map((t) => {
        const price = priceFor(t.provider_tour_id);
        return price === null
          ? { ...t }
          : { ...t, price_minor: price, currency: "USD" };
      }),
  } as unknown as PriceResolver;
}

/** The default price resolver: every tour gets a valid positive price. */
const pricingResolver = fakePriceResolver();

/** In-memory quarantine store so the real validator runs without a DB. */
class InMemoryQuarantineStore implements QuarantineStore {
  readonly saved: QuarantineRecord[] = [];
  async save(record: QuarantineRecord): Promise<void> {
    this.saved.push(record);
  }
}

/** An upsert stub that records every `upsertBatch` call's tours. */
function fakeUpsert(): { service: TourUpsertService; batchCalls: TourDTO[][] } {
  const batchCalls: TourDTO[][] = [];
  const service = {
    async upsertBatch(tours: TourDTO[]): Promise<UpsertBatchResult> {
      batchCalls.push(tours);
      return { upserted: tours.length };
    },
  } as unknown as TourUpsertService;
  return { service, batchCalls };
}

describe("ImportPipeline", () => {
  let store: InMemoryQuarantineStore;
  let validator: TourValidator;

  beforeEach(() => {
    store = new InMemoryQuarantineStore();
    validator = new TourValidator(store);
  });

  it("threads all stages per page and tallies every count on a clean segment", async () => {
    const client = fakeClient([
      [rawProduct("A"), rawProduct("B")],
      [rawProduct("C")],
    ]);
    const { service: upsert, batchCalls } = fakeUpsert();

    const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert);
    const counts = new ImportRunCounts();
    const result = await pipeline.runSegment(counts, {
      fetchedAt: FETCHED_AT,
      restartEveryNPages: NEVER_STOPS_EARLY,
    });

    expect(result.done).toBe(true);
    expect(counts.fetched).toBe(3);
    expect(counts.normalized).toBe(3);
    expect(counts.quarantined).toBe(0);
    expect(counts.upserted).toBe(3); // summed across both pages' upsertBatch calls
    expect(counts.cursor).toBeNull(); // segment ran to the crawl's true end
    expect(counts.lastPage).toBe(2);

    // BRI-170: one upsertBatch call per page that had survivors, not one
    // call for the whole segment.
    expect(batchCalls).toHaveLength(2);
    expect(batchCalls[0].map((t) => t.provider_tour_id)).toEqual(["A", "B"]);
    expect(batchCalls[1].map((t) => t.provider_tour_id)).toEqual(["C"]);
  });

  it("counts a quarantined tour and keeps it out of its page's upsert batch", async () => {
    // "B" resolves to no price → quarantined by the real validator (MISSING_PRICE).
    const client = fakeClient([[rawProduct("A"), rawProduct("B")]]);
    const { service: upsert, batchCalls } = fakeUpsert();
    // Price "A" normally, leave "B" unpriced.
    const priceResolver = fakePriceResolver((code) => (code === "B" ? null : 2500));

    const pipeline = new ImportPipeline(client, passthroughResolver, priceResolver, validator, upsert);
    const counts = new ImportRunCounts();
    await pipeline.runSegment(counts, {
      fetchedAt: FETCHED_AT,
      restartEveryNPages: NEVER_STOPS_EARLY,
    });

    expect(counts.fetched).toBe(2);
    expect(counts.normalized).toBe(2);
    expect(counts.quarantined).toBe(1);
    expect(counts.upserted).toBe(1);
    expect(store.saved).toHaveLength(1);
    // Only the passing tour "A" is upserted.
    expect(batchCalls[0].map((t) => t.provider_tour_id)).toEqual(["A"]);
  });

  it("skips (does not crash on) an unnormalizable product", async () => {
    // In-scope (curated/ACTIVE/instant) but missing productCode → survives the
    // scope filter, then the normalizer throws → pipeline skips it.
    const unnormalizable = rawProduct("", { productCode: undefined, title: "no code" });
    const client = fakeClient([[rawProduct("A"), unnormalizable]]);
    const { service: upsert } = fakeUpsert();

    const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert);
    const counts = new ImportRunCounts();
    await pipeline.runSegment(counts, {
      fetchedAt: FETCHED_AT,
      restartEveryNPages: NEVER_STOPS_EARLY,
    });

    expect(counts.fetched).toBe(2); // both raw products were fetched
    expect(counts.normalized).toBe(1); // only "A" normalized
  });

  it("scope-filters a raw product outside the curated destinations before normalize", async () => {
    const outOfScope = rawProduct("Z", { destinations: [{ ref: "999" }] });
    const client = fakeClient([[rawProduct("A"), outOfScope]]);
    const { service: upsert, batchCalls } = fakeUpsert();

    const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert);
    const counts = new ImportRunCounts();
    await pipeline.runSegment(counts, {
      fetchedAt: FETCHED_AT,
      restartEveryNPages: NEVER_STOPS_EARLY,
    });

    expect(counts.fetched).toBe(2); // both raw products were scanned
    expect(counts.normalized).toBe(1); // only the curated one normalized
    expect(batchCalls[0].map((t) => t.provider_tour_id)).toEqual(["A"]);
  });

  it("scope-filters an INACTIVE product and a MANUAL-confirmation product before normalize", async () => {
    const inactive = rawProduct("INACT", { status: "INACTIVE" });
    const manual = rawProduct("MANUAL", {
      bookingConfirmationSettings: { confirmationType: "MANUAL" },
    });
    const client = fakeClient([[rawProduct("A"), inactive, manual]]);
    const { service: upsert, batchCalls } = fakeUpsert();

    const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert);
    const counts = new ImportRunCounts();
    await pipeline.runSegment(counts, {
      fetchedAt: FETCHED_AT,
      restartEveryNPages: NEVER_STOPS_EARLY,
    });

    expect(counts.fetched).toBe(3);
    expect(counts.normalized).toBe(1); // only "A" — inactive and manual are scoped out
    expect(batchCalls[0].map((t) => t.provider_tour_id)).toEqual(["A"]);
  });

  it("never buffers more than one page's raw products, or one page's curated survivors, at a time", async () => {
    // Three pages, each containing one curated product and 499 out-of-scope
    // ones. If the scope filter didn't run per-page, `pageDtos` would hold raw
    // products from every page; if survivors weren't upserted per page (the
    // actual BRI-170 bug), `upsertBatch` would be called once at the very end
    // with all 3 curated tours instead of three times with 1 each. Proving
    // both is a proxy for the OOM fix without actually allocating gigabytes in
    // a unit test.
    const outOfScope = (i: number) => rawProduct(`skip-${i}`, { destinations: [{ ref: "999" }] });
    const pages = [0, 1, 2].map((p) => [
      rawProduct(`curated-${p}`),
      ...Array.from({ length: 499 }, (_, i) => outOfScope(p * 499 + i)),
    ]);
    const client = fakeClient(pages);
    const { service: upsert, batchCalls } = fakeUpsert();

    const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert);
    const counts = new ImportRunCounts();
    await pipeline.runSegment(counts, {
      fetchedAt: FETCHED_AT,
      restartEveryNPages: NEVER_STOPS_EARLY,
    });

    expect(counts.fetched).toBe(1500);
    expect(counts.normalized).toBe(3);
    // BRI-170: three separate one-tour batches, not one three-tour batch.
    expect(batchCalls).toHaveLength(3);
    expect(batchCalls.every((batch) => batch.length === 1)).toBe(true);
    expect(batchCalls.map((batch) => batch[0].provider_tour_id)).toEqual([
      "curated-0",
      "curated-1",
      "curated-2",
    ]);
  });

  it("propagates a stage's error with counts already reflecting every prior page", async () => {
    // upsertBatch throws on the second page — counts must still reflect the
    // first page's committed work, so a caller (segment-worker) can persist
    // an accurate partial result even on failure.
    const client = fakeClient([
      [rawProduct("A")],
      [rawProduct("B")],
    ]);
    const batchCalls: TourDTO[][] = [];
    let call = 0;
    const upsert = {
      async upsertBatch(tours: TourDTO[]): Promise<UpsertBatchResult> {
        call += 1;
        if (call === 2) throw new Error("boom");
        batchCalls.push(tours);
        return { upserted: tours.length };
      },
    } as unknown as TourUpsertService;

    const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert);
    const counts = new ImportRunCounts();

    await expect(
      pipeline.runSegment(counts, {
        fetchedAt: FETCHED_AT,
        restartEveryNPages: NEVER_STOPS_EARLY,
      }),
    ).rejects.toThrow("boom");

    expect(counts.fetched).toBe(2); // both pages' raw products were scanned
    expect(counts.normalized).toBe(2);
    expect(counts.upserted).toBe(1); // only page 1's batch committed
    expect(batchCalls).toHaveLength(1);
  });

  describe("BRI-176: segment bounding", () => {
    it("stops after N pages, resuming from the correct cursor, with the exact next-segment startCursor/startPage", async () => {
      const pages = [0, 1, 2, 3, 4].map((p) => [rawProduct(`P${p}`)]);
      const { client, calls } = fakeResumableClient(pages);
      const { service: upsert, batchCalls } = fakeUpsert();

      const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert);

      // Segment 1: pages 1-2.
      const counts1 = new ImportRunCounts();
      const result1 = await pipeline.runSegment(counts1, {
        fetchedAt: FETCHED_AT,
        restartEveryNPages: 2,
      });
      expect(result1.done).toBe(false);
      expect(counts1.cursor).toBe("cursor-2");
      expect(counts1.lastPage).toBe(2);
      expect(calls[0]).toEqual({ startCursor: undefined, startPage: undefined });

      // Segment 2 (resumed): pages 3-4.
      const counts2 = new ImportRunCounts();
      const result2 = await pipeline.runSegment(counts2, {
        fetchedAt: FETCHED_AT,
        restartEveryNPages: 2,
        startCursor: counts1.cursor ?? undefined,
        startPage: counts1.lastPage ?? undefined,
      });
      expect(result2.done).toBe(false);
      expect(counts2.cursor).toBe("cursor-4");
      expect(counts2.lastPage).toBe(4);
      expect(calls[1]).toEqual({ startCursor: "cursor-2", startPage: 2 });

      // Segment 3 (resumed): page 5, reaches the crawl's true end.
      const counts3 = new ImportRunCounts();
      const result3 = await pipeline.runSegment(counts3, {
        fetchedAt: FETCHED_AT,
        restartEveryNPages: 2,
        startCursor: counts2.cursor ?? undefined,
        startPage: counts2.lastPage ?? undefined,
      });
      expect(result3.done).toBe(true);
      expect(counts3.cursor).toBeNull();
      expect(calls[2]).toEqual({ startCursor: "cursor-4", startPage: 4 });

      // Every page processed exactly once across the three segments — same
      // totals a single non-restarting 5-page run would produce.
      expect(batchCalls.flat().map((t) => t.provider_tour_id)).toEqual([
        "P0",
        "P1",
        "P2",
        "P3",
        "P4",
      ]);
    });

    it("reports done on a segment shorter than N (never stops early)", async () => {
      const pages = [[rawProduct("A")], [rawProduct("B")]];
      const { client, calls } = fakeResumableClient(pages);
      const { service: upsert } = fakeUpsert();

      const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert);
      const counts = new ImportRunCounts();
      const result = await pipeline.runSegment(counts, {
        fetchedAt: FETCHED_AT,
        restartEveryNPages: 10,
      });

      expect(result.done).toBe(true);
      expect(calls).toHaveLength(1);
      expect(counts.fetched).toBe(2);
      expect(counts.cursor).toBeNull();
    });

    it("stops based on total pages scanned, not just pages with curated survivors", async () => {
      // Every page here is entirely out-of-scope (BRI-170/171 scope filter) —
      // if the stop check only ran when a page had survivors, this segment
      // would never stop at all. It must still stop on raw page count.
      const outOfScope = (i: number) => rawProduct(`skip-${i}`, { destinations: [{ ref: "999" }] });
      const pages = [0, 1, 2].map((p) => [outOfScope(p)]);
      const { client } = fakeResumableClient(pages);
      const { service: upsert } = fakeUpsert();

      const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert);
      const counts = new ImportRunCounts();
      const result = await pipeline.runSegment(counts, {
        fetchedAt: FETCHED_AT,
        restartEveryNPages: 2,
      });

      expect(result.done).toBe(false);
      expect(counts.fetched).toBe(2); // stopped after page 2, not all 3
      expect(counts.normalized).toBe(0);
      expect(counts.cursor).toBe("cursor-2");
    });
  });
});
