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
  type FinalizeSoftDeleteResult,
  type TourUpsertService,
  type UpsertBatchResult,
} from "./upsert";
import {
  TourValidator,
  type QuarantineRecord,
  type QuarantineStore,
} from "./validator";

/**
 * Unit tests for {@link ImportPipeline} (ST-10 / BRI-107, restructured by
 * BRI-170).
 *
 * These prove the orchestration contract without a DB or network: stages are
 * threaded in order **per page** (BRI-170: geo-resolve/price-resolve/validate/
 * upsert now happen inside the page loop, not after it, so at most one page's
 * curated survivors are ever held as full `TourDTO` objects), and — the
 * property the run record depends on — the caller-owned {@link ImportRunCounts}
 * reflects each stage's tally *even when a later stage throws*, so an aborted
 * run can still be recorded accurately.
 */

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

/**
 * An upsert stub that records every `upsertBatch` call's tours and returns a
 * canned `finalizeGuardedSoftDelete` result. `upsertBatch` echoes back
 * `tours.length` as `upserted`, matching the real implementation's contract.
 */
function fakeUpsert(finalizeResult: FinalizeSoftDeleteResult): {
  service: TourUpsertService;
  batchCalls: TourDTO[][];
  finalizeCalls: { incomingIds: string[]; provider: string }[];
} {
  const batchCalls: TourDTO[][] = [];
  const finalizeCalls: { incomingIds: string[]; provider: string }[] = [];
  const service = {
    async upsertBatch(tours: TourDTO[]): Promise<UpsertBatchResult> {
      batchCalls.push(tours);
      return { upserted: tours.length };
    },
    async finalizeGuardedSoftDelete(
      incomingIds: string[],
      provider: string,
    ): Promise<FinalizeSoftDeleteResult> {
      finalizeCalls.push({ incomingIds, provider });
      return finalizeResult;
    },
  } as unknown as TourUpsertService;
  return { service, batchCalls, finalizeCalls };
}

/** An upsert stub whose `finalizeGuardedSoftDelete` always trips the guard. `upsertBatch` still succeeds — proving upserts commit even when the later guard aborts. */
function abortingUpsert(): { service: TourUpsertService; batchCalls: TourDTO[][] } {
  const batchCalls: TourDTO[][] = [];
  const service = {
    async upsertBatch(tours: TourDTO[]): Promise<UpsertBatchResult> {
      batchCalls.push(tours);
      return { upserted: tours.length };
    },
    async finalizeGuardedSoftDelete(): Promise<FinalizeSoftDeleteResult> {
      throw new MassDeletionAbortError("viator", 10, 8, 80, 10);
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

  it("threads all stages per page and tallies every count on a clean run", async () => {
    const client = fakeClient([
      [rawProduct("A"), rawProduct("B")],
      [rawProduct("C")],
    ]);
    const { service: upsert, batchCalls, finalizeCalls } = fakeUpsert({
      softDeleted: 1,
      activeCountBefore: 4,
    });

    const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert, noopLinker);
    const counts = new ImportRunCounts();
    await pipeline.run(counts, { deleteGuardThresholdPct: 10 });

    expect(counts.fetched).toBe(3);
    expect(counts.normalized).toBe(3);
    expect(counts.quarantined).toBe(0);
    expect(counts.upserted).toBe(3); // summed across both pages' upsertBatch calls
    expect(counts.softDeleted).toBe(1);
    expect(counts.cursor).toBeNull(); // crawl ran to completion

    // BRI-170: one upsertBatch call per page that had survivors, not one
    // call for the whole run.
    expect(batchCalls).toHaveLength(2);
    expect(batchCalls[0].map((t) => t.provider_tour_id)).toEqual(["A", "B"]);
    expect(batchCalls[1].map((t) => t.provider_tour_id)).toEqual(["C"]);

    // Exactly one finalize call, at the end, with every upserted id.
    expect(finalizeCalls).toHaveLength(1);
    expect(finalizeCalls[0].incomingIds.sort()).toEqual(["A", "B", "C"]);
    expect(finalizeCalls[0].provider).toBe("viator");
  });

  it("counts a quarantined tour and keeps it out of its page's upsert batch", async () => {
    // "B" resolves to no price → quarantined by the real validator (MISSING_PRICE).
    const client = fakeClient([[rawProduct("A"), rawProduct("B")]]);
    const { service: upsert, batchCalls } = fakeUpsert({
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
    const { service: upsert } = fakeUpsert({ softDeleted: 0, activeCountBefore: 1 });

    const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert, noopLinker);
    const counts = new ImportRunCounts();
    await pipeline.run(counts, { deleteGuardThresholdPct: 10 });

    expect(counts.fetched).toBe(2); // both raw products were fetched
    expect(counts.normalized).toBe(1); // only "A" normalized
  });

  it("scope-filters a raw product outside the curated destinations before normalize", async () => {
    const outOfScope = rawProduct("Z", { destinations: [{ ref: "999" }] });
    const client = fakeClient([[rawProduct("A"), outOfScope]]);
    const { service: upsert, batchCalls } = fakeUpsert({ softDeleted: 0, activeCountBefore: 1 });

    const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert, noopLinker);
    const counts = new ImportRunCounts();
    await pipeline.run(counts, { deleteGuardThresholdPct: 10 });

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
    const { service: upsert, batchCalls } = fakeUpsert({ softDeleted: 0, activeCountBefore: 1 });

    const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert, noopLinker);
    const counts = new ImportRunCounts();
    await pipeline.run(counts, { deleteGuardThresholdPct: 10 });

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
    const { service: upsert, batchCalls } = fakeUpsert({ softDeleted: 0, activeCountBefore: 0 });

    const pipeline = new ImportPipeline(client, passthroughResolver, pricingResolver, validator, upsert, noopLinker);
    const counts = new ImportRunCounts();
    await pipeline.run(counts, { deleteGuardThresholdPct: 10 });

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

  it("BRI-170: upserts already-seen pages even when the final guard aborts the soft-delete", async () => {
    const client = fakeClient([[rawProduct("A"), rawProduct("B")]]);
    const { service: upsert, batchCalls } = abortingUpsert();
    const pipeline = new ImportPipeline(
      client,
      passthroughResolver,
      pricingResolver,
      validator,
      upsert,
      noopLinker,
    );
    const counts = new ImportRunCounts();

    await expect(
      pipeline.run(counts, { deleteGuardThresholdPct: 10 }),
    ).rejects.toBeInstanceOf(MassDeletionAbortError);

    // The page's upsertBatch call already happened and is reflected in counts
    // — this is the deliberate behavior change from the old "aborts write
    // nothing" guarantee (see the BRI-170 plan's Design Decision).
    expect(counts.fetched).toBe(2);
    expect(counts.normalized).toBe(2);
    expect(counts.quarantined).toBe(0);
    expect(counts.upserted).toBe(2);
    expect(counts.softDeleted).toBe(0); // the soft-delete itself never committed
    expect(batchCalls).toHaveLength(1);
  });
});
