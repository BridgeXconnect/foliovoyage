import { beforeEach, describe, expect, it } from "@jest/globals";

import type { ViatorClient, ViatorPage } from "./clients/viator.client";
import type { ViatorProduct } from "./clients/viator.types";
import type { ExperienceLinker } from "./experience-linker";
import type { LocationResolver } from "./location-resolver";
import { ImportPipeline, ImportRunCounts } from "./import.pipeline";
import type { TourDTO } from "./normalizer";
import type { PriceResolver } from "./price-resolver";
import {
  MassDeletionAbortError,
  type TourUpsertService,
  type UpsertRunResult,
} from "./upsert";
import {
  TourValidator,
  type QuarantineRecord,
  type QuarantineStore,
} from "./validator";

/**
 * Unit tests for {@link ImportPipeline} (ST-10 / BRI-107).
 *
 * These prove the orchestration contract without a DB or network: the stages
 * are threaded in order, and — the property the run record depends on — the
 * caller-owned {@link ImportRunCounts} reflects each stage's tally *even when a
 * later stage throws*, so an aborted run can still be recorded accurately.
 */

/**
 * A raw Viator product the normalizer will accept. No price: a real product
 * payload carries none (BRI-165) — price is attached later by the price resolver,
 * faked below.
 */
function rawProduct(code: string, overrides: Record<string, unknown> = {}): ViatorProduct {
  return {
    productCode: code,
    title: `Tour ${code}`,
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

/** A linker that no-ops (these unit tests have no curated tours / DB). */
const noopLinker = {
  linkRun: async (): Promise<{
    created: number;
    linked: number;
    skippedMissingCity: number;
  }> => ({ created: 0, linked: 0, skippedMissingCity: 0 }),
} as unknown as ExperienceLinker;

/** In-memory quarantine store so the real validator runs without a DB. */
class InMemoryQuarantineStore implements QuarantineStore {
  readonly saved: QuarantineRecord[] = [];
  async save(record: QuarantineRecord): Promise<void> {
    this.saved.push(record);
  }
}

/** An upsert stub that records its input and returns a canned result. */
function fakeUpsert(
  result: UpsertRunResult,
): { service: TourUpsertService; calls: TourDTO[][] } {
  const calls: TourDTO[][] = [];
  const service = {
    async upsertRun(tours: TourDTO[]): Promise<UpsertRunResult> {
      calls.push(tours);
      return result;
    },
  } as unknown as TourUpsertService;
  return { service, calls };
}

/** An upsert stub that always trips the mass-deletion guard. */
function abortingUpsert(): TourUpsertService {
  return {
    async upsertRun(): Promise<UpsertRunResult> {
      throw new MassDeletionAbortError("viator", 10, 8, 80, 10);
    },
  } as unknown as TourUpsertService;
}

describe("ImportPipeline", () => {
  let store: InMemoryQuarantineStore;
  let validator: TourValidator;

  beforeEach(() => {
    store = new InMemoryQuarantineStore();
    validator = new TourValidator(store);
  });

  it("threads all stages and tallies every count on a clean run", async () => {
    const client = fakeClient([
      [rawProduct("A"), rawProduct("B")],
      [rawProduct("C")],
    ]);
    const { service: upsert, calls } = fakeUpsert({
      upserted: 3,
      softDeleted: 1,
      activeCountBefore: 4,
    });

    const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert, noopLinker);
    const counts = new ImportRunCounts();
    await pipeline.run(counts, { deleteGuardThresholdPct: 10 });

    expect(counts.fetched).toBe(3);
    expect(counts.normalized).toBe(3);
    expect(counts.quarantined).toBe(0);
    expect(counts.upserted).toBe(3);
    expect(counts.softDeleted).toBe(1);
    expect(counts.cursor).toBeNull(); // crawl ran to completion
    // All three passed validation and reached the upsert as one batch.
    expect(calls).toHaveLength(1);
    expect(calls[0].map((t) => t.provider_tour_id)).toEqual(["A", "B", "C"]);
  });

  it("counts a quarantined tour and keeps it out of the upsert batch", async () => {
    // "B" resolves to no price → quarantined by the real validator (MISSING_PRICE).
    const client = fakeClient([[rawProduct("A"), rawProduct("B")]]);
    const { service: upsert, calls } = fakeUpsert({
      upserted: 1,
      softDeleted: 0,
      activeCountBefore: 1,
    });
    // Price "A" normally, leave "B" unpriced.
    const priceResolver = fakePriceResolver((code) => (code === "B" ? null : 2500));

    const pipeline = new ImportPipeline(client, passthroughResolver, priceResolver, validator, upsert, noopLinker);
    const counts = new ImportRunCounts();
    await pipeline.run(counts, { deleteGuardThresholdPct: 10 });

    expect(counts.fetched).toBe(2);
    expect(counts.normalized).toBe(2);
    expect(counts.quarantined).toBe(1);
    expect(store.saved).toHaveLength(1);
    // Only the passing tour "A" is upserted.
    expect(calls[0].map((t) => t.provider_tour_id)).toEqual(["A"]);
  });

  it("skips (does not crash on) an unnormalizable product", async () => {
    // Missing productCode → normalizer throws → pipeline skips it.
    const client = fakeClient([[rawProduct("A"), { title: "no code" }]]);
    const { service: upsert } = fakeUpsert({
      upserted: 1,
      softDeleted: 0,
      activeCountBefore: 1,
    });

    const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert, noopLinker);
    const counts = new ImportRunCounts();
    await pipeline.run(counts, { deleteGuardThresholdPct: 10 });

    expect(counts.fetched).toBe(2); // both raw products were fetched
    expect(counts.normalized).toBe(1); // only "A" normalized
  });

  it("propagates a guard abort with the earlier counts already tallied", async () => {
    const client = fakeClient([[rawProduct("A"), rawProduct("B")]]);
    const pipeline = new ImportPipeline(
      client,
      passthroughResolver,
      pricingResolver,
      validator,
      abortingUpsert(),
      noopLinker,
    );
    const counts = new ImportRunCounts();

    await expect(
      pipeline.run(counts, { deleteGuardThresholdPct: 10 }),
    ).rejects.toBeInstanceOf(MassDeletionAbortError);

    // The pre-upsert stages' counts survive the throw; upsert counts stay 0.
    expect(counts.fetched).toBe(2);
    expect(counts.normalized).toBe(2);
    expect(counts.quarantined).toBe(0);
    expect(counts.upserted).toBe(0);
    expect(counts.softDeleted).toBe(0);
  });
});
