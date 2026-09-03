import { randomBytes } from "node:crypto";

import { describe, expect, it } from "@jest/globals";

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
 * BRI-182: proves the memory-pressure restart trigger fires against a
 * *real*, uninjected `process.memoryUsage()` reading — not just the
 * deterministic scripted-provider tests in `import.pipeline.spec.ts`.
 *
 * Deliberately kept in its own file, separate from that larger spec. Jest
 * gives each spec *file* its own worker process by default, and this test's
 * assertion depends on `process.memoryUsage().rss` actually growing when a
 * heavy page is processed. Sharing a worker with a dozen-plus prior tests
 * (as this test did originally, colocated in `import.pipeline.spec.ts`)
 * warms that worker's heap up to a large, noisy baseline (~350MB observed)
 * with enough already-committed slack that a heavy page's allocations can
 * land inside existing pages without any measurable `rss` delta at all —
 * not because the trigger is broken, but because the test process's heap
 * state, not the pipeline, absorbed the growth. Running this test alone in
 * a fresh worker gives it the low, stable baseline the assertion needs.
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

/**
 * A heavy raw product (BRI-182), shaped after real archived evidence: three
 * real Viator products from one supplier family (`5632934P13`, `5632934P8`,
 * `5632934P12`) each embed a large nested `logistics.start[].location`
 * pickup-list structure per booking option (real average ~910KB/option
 * across 4 options, ~3.6MB/product), clustering on certain pages (the
 * crashed run's page 2 matched a fresh run's page ~110 byte-for-byte: 500
 * products, ~39MB, largest single product ~4.6MB).
 *
 * This fixture reproduces that real *shape and scale* — three heavy
 * products, the same `logistics.start[].location` field, four options each,
 * at the literal real ~910KB/option average.
 *
 * The content is high-entropy random bytes (hex-encoded), not a repeated
 * character. A degenerate string like `"x".repeat(n)` is real content this
 * test measures `process.memoryUsage().rss` against, and on macOS the
 * kernel's transparent memory compressor collapses that pattern almost to
 * nothing — `rss` then barely grows no matter how large `n` is, which would
 * make this test measure macOS's compressor, not the pipeline. Real Viator
 * pickup-list JSON is ordinary high-entropy text, so random bytes are also
 * the more faithful fixture, not just the more reliable one.
 */
function heavyRawProduct(code: string, optionSizeBytes = 910 * 1024): ViatorProduct {
  const heavyOption = () => ({
    location: { pickupPoints: randomBytes(Math.ceil(optionSizeBytes / 2)).toString("hex") },
  });
  return rawProduct(code, {
    logistics: { start: [heavyOption(), heavyOption(), heavyOption(), heavyOption()] },
  });
}

/** A resolver that leaves coordinates untouched (pass-through). */
const passthroughResolver = {
  attachLocations: async (tours: TourDTO[]): Promise<TourDTO[]> =>
    tours.map((t) => ({ ...t })),
} as unknown as LocationResolver;

/** A price resolver that attaches a valid positive price to every tour. */
const pricingResolver = {
  attachPrices: async (tours: TourDTO[]): Promise<TourDTO[]> =>
    tours.map((t) => ({ ...t, price_minor: 2500, currency: "USD" })),
} as unknown as PriceResolver;

/** In-memory quarantine store so the real validator runs without a DB. */
class InMemoryQuarantineStore implements QuarantineStore {
  readonly saved: QuarantineRecord[] = [];
  async save(record: QuarantineRecord): Promise<void> {
    this.saved.push(record);
  }
}

/** An upsert stub that just counts each `upsertBatch` call's tours. */
function fakeUpsert(): TourUpsertService {
  return {
    async upsertBatch(tours: TourDTO[]): Promise<UpsertBatchResult> {
      return { upserted: tours.length };
    },
  } as unknown as TourUpsertService;
}

/** Large enough that the page-count trigger alone would never stop this segment. */
const NEVER_STOPS_EARLY = 1000;

describe("ImportPipeline — BRI-182 memory trigger (real process.memoryUsage())", () => {
  it(
    "detects a realistic heavy page via the real, uninjected provider and stops the segment",
    async () => {
      // Reproduces the real page shape from BRI-182's decisive evidence:
      // three heavy products (matching the real 5632934P13/P8/P12 cluster)
      // among ~500 total, ~39MB page weight — see heavyRawProduct's docstring.
      //
      // The heavy page is built *lazily*, inside the generator, so its
      // ~11MB of heavy strings are only allocated once `runSegment` starts
      // iterating — i.e. after `baselineRss` below is captured. Building it
      // eagerly would bake the spike into the baseline itself and leave no
      // delta to detect, matching how the real crawl only allocates a
      // page's data once that page is actually fetched, not before.
      //
      // `retained` holds a strong reference to each yielded page's raw
      // products for the rest of the test. Without it, V8's generational GC
      // can reclaim the heavy arrays as soon as the generator's local
      // variables go out of scope after the `yield` — this codebase's own
      // pipeline only keeps *normalized* `TourDTO`s past that point, so
      // nothing else holds the raw payload live either. In the real crawl,
      // the raw page is kept alive for longer by genuine concurrent async
      // work (archiving to R2, awaited I/O) that this synchronous fake
      // doesn't have — `retained` stands in for that real-world retention so
      // the test measures the same thing the real trigger does: memory that
      // is actually still live when the next page-boundary check runs.
      const retained: unknown[] = [];
      const client: ViatorClient = {
        async *fetchModifiedSince(): AsyncGenerator<ViatorPage> {
          // NB: .map(heavyRawProduct) directly would leak the array index in
          // as heavyRawProduct's second parameter (optionSizeBytes) — Array.map
          // calls its callback with (element, index, array).
          const heavyProducts = ["5632934P13", "5632934P8", "5632934P12"].map((code) =>
            heavyRawProduct(code),
          );
          const lightProducts = Array.from({ length: 497 }, (_, i) => rawProduct(`light-${i}`));
          retained.push(heavyProducts, lightProducts);
          yield {
            page: 1,
            products: [...heavyProducts, ...lightProducts],
            nextCursor: "cursor-2",
            archive: { bucket: "b", key: "k-1" },
          };
          yield {
            page: 2,
            products: [rawProduct("never-reached")],
            nextCursor: undefined,
            archive: { bucket: "b", key: "k-2" },
          };
        },
      } as unknown as ViatorClient;

      const validator = new TourValidator(new InMemoryQuarantineStore());
      // No injected provider: exercises the real, default `process.memoryUsage` path.
      const pipeline = new ImportPipeline(
        client,
        passthroughResolver,
        pricingResolver,
        validator,
        fakeUpsert(),
      );

      const baselineRss = process.memoryUsage().rss;
      const counts = new ImportRunCounts();
      const result = await pipeline.runSegment(counts, {
        fetchedAt: FETCHED_AT,
        restartEveryNPages: NEVER_STOPS_EARLY, // only the memory trigger can stop this segment
        // A low bar, comfortably below the tens-of-MB this page's ~11MB of
        // deliberately-allocated heavy strings should push real rss up by —
        // not a tuned production threshold, just enough margin to make the
        // assertion robust to ordinary GC/JIT noise between the two readings.
        restartMemoryThresholdBytes: baselineRss + 5 * 1024 * 1024,
      });

      expect(result.done).toBe(false);
      expect(counts.lastPage).toBe(1); // stopped after the heavy page, never reached page 2
      expect(counts.fetched).toBe(500);
    },
    15000,
  );
});
