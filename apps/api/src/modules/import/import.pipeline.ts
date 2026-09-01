import { Logger } from "@nestjs/common";

import type { ViatorClient } from "./clients/viator.client";
import type { LocationResolver } from "./location-resolver";
import { normalizeViatorProduct, type TourDTO } from "./normalizer";
import type { PriceResolver } from "./price-resolver";
import { decideIngestScope } from "./scope-filter";
import type { TourUpsertService } from "./upsert";
import { ImportRunStats, type TourValidator } from "./validator";

/**
 * Import pipeline orchestrator (ST-10 / BRI-107, restructured by BRI-170,
 * split into per-segment processes by BRI-176).
 *
 * Threads the existing, already-merged stages together, per page, within one
 * bounded segment ({@link runSegment}):
 *
 *   ST-6 {@link ViatorClient} (fetch + archive, one page at a time)
 *     → BRI-170/171 {@link decideIngestScope} (curated destination + ACTIVE +
 *       non-manual-confirmation — per raw product, before anything downstream)
 *     → ST-7 {@link normalizeViatorProduct} (normalize)
 *     → ST-7b {@link LocationResolver} (resolve start coordinates)
 *     → ST-7c {@link PriceResolver} (resolve "from" price from schedules)
 *     → ST-8 {@link TourValidator} (validate / quarantine)
 *     → ST-9 {@link TourUpsertService.upsertBatch} (idempotent upsert, this page)
 *
 * — all run **per page**, before the next page is fetched. A **run** (the
 * whole crawl, start to true finish) spans one or more **segments**
 * (BRI-176): `ImportRunService` orchestrates a sequence of short-lived OS
 * processes (`segment-worker.cli.ts`), each running exactly one
 * {@link runSegment} call. Once the *last* segment's `runSegment` reports
 * `done: true`, that same process calls
 * {@link TourUpsertService.finalizeGuardedSoftDelete} once (soft-delete +
 * mass-deletion guard, using every id upserted across every segment of the
 * run — reconstructed from the DB, not carried in memory; see that method's
 * class docstring) and then `ExperienceLinker` links the committed catalogue.
 * Neither call lives in this class any more — see `segment-worker.cli.ts`.
 *
 * M1 is deliberately synchronous within a segment: no queue, no worker (that
 * is ST-33 in M6) — `child_process.spawn` between segments is BRI-176's own
 * concession to memory, not a queue. `runSegment` adds no counting or
 * validation logic of its own — it only wires the stages and threads the
 * counts each stage already reports into a caller-owned {@link ImportRunCounts}.
 *
 * That counts object is passed *in* and mutated as the segment progresses,
 * so it reflects the work done **even when a later stage throws**. BRI-170:
 * `upserted` reflects every page's `upsertBatch` call that already
 * committed in this segment — a deliberate change from the pre-BRI-170
 * behavior where an aborted run wrote nothing at all (see the BRI-170 plan's
 * Design Decision for why the guard's scope narrowed to just the
 * soft-delete step).
 *
 * **BRI-170.** `/products/modified-since` has no server-side destination
 * filter — it returns Viator's *entire* global catalog, and Atlas only ingests
 * 6 curated cities out of it. Two bugs compounded to OOM the pipeline, fixed in
 * two stages:
 *
 * 1. The scope filter used to run last, inside `ExperienceLinker`, *after*
 *    every product in the whole catalog had already been normalized,
 *    geo-resolved, and — critically — had a live per-product
 *    `/availability/schedules` call fired for it by the price resolver. The
 *    first fix moved the scope filter to run **immediately per page**, before
 *    normalize ever sees a raw product, bounding the *raw* page held in memory
 *    to at most one page (≤500 raw products) at a time.
 * 2. That first fix still accumulated every curated **survivor** — normalized,
 *    location-resolved, price-resolved `TourDTO`s — into one array for the
 *    *entire* crawl, only geo-resolving/price-resolving/validating/upserting
 *    them as one batch at the very end. Live production evidence (two
 *    consecutive nightly runs, both OOM-killed on Render's 512MiB free-tier
 *    instance) showed this is a real, unbounded-by-catalog-size accumulation:
 *    the curated-match rate is roughly 6% of the scanned catalog, not the
 *    handful of tours once assumed here — thousands of `TourDTO`s across a
 *    full ~400K-product crawl, not "~90 tours total." This file's fix was
 *    {@link runSegment} below: every stage after normalize also runs per
 *    page, so at most one page's curated survivors (a small fraction of ≤500)
 *    are ever held as full `TourDTO` objects.
 *
 * **BRI-176.** BRI-170's fix above stopped app-level `TourDTO` accumulation,
 * but two real nightly runs still OOM-killed on Render's 512MiB instance
 * afterward (died at page 67, then page 147 — steady climb, no single spike).
 * Local heap profiling (Docker, capped at Render's real 512MB limit, real
 * fetch+archive stage against the real Viator API) localized the cause to
 * `undici`'s HTTP response decoding inside {@link ViatorClient.fetchModifiedSince}
 * itself: ~90%+ of retained allocation traces there, growing monotonically
 * with page count, released only when one continuous `fetchModifiedSince()`
 * generator consumption ends.
 *
 * A first fix (an in-process generator restart, breaking and re-entering
 * `fetchModifiedSince` every N pages within the same call) was tried and
 * measurably helped — but two capped verification runs showed a real,
 * if noisy, residual accumulation surviving an in-process `break`, unlike
 * the clean, complete release BRI-176 confirmed for a *naturally-completed*
 * generator. So this method ({@link runSegment}) is deliberately bounded to
 * **one segment** (at most `options.restartEveryNPages` pages, or the whole
 * crawl if it finishes first) and does not loop or restart internally at
 * all — the actual restart now happens one level up, as a full **OS process**
 * exit/respawn, orchestrated by {@link import("./import-run.service").ImportRunService}
 * spawning a fresh `segment-worker.cli.ts` child per segment. That guarantees
 * the same complete release BRI-176 measured for a natural exit, since a
 * process exiting *is* a natural exit for everything in it.
 *
 * Because a run now spans multiple processes, this method takes `fetchedAt`
 * as a required input (sourced from `ImportRun.startedAt`, not computed
 * locally) so every segment of one run — regardless of which process ran
 * it — stamps the identical provenance timestamp on every row it touches.
 * `finalizeGuardedSoftDelete` and `ExperienceLinker` are **not** called here
 * any more (they must run exactly once per *run*, not once per *segment*) —
 * see `segment-worker.cli.ts`, which calls them only when {@link runSegment}
 * reports `done: true`, reconstructing the run's full incoming-id set from
 * the DB (`Tour` rows sharing this run's `fetchedAt`) rather than carrying an
 * in-memory list across process boundaries.
 */

/** Mutable per-run tally, owned by the caller and threaded through the run. */
export class ImportRunCounts {
  /** Raw products pulled from the provider (ST-6). */
  fetched = 0;
  /** Products that normalized to a DTO without error (ST-7). */
  normalized = 0;
  /** Tours quarantined by the validator (ST-8). */
  quarantined = 0;
  /** Rows inserted or updated in the live catalogue (ST-9), summed across pages. */
  upserted = 0;
  /** Rows soft-deleted this run (ST-9, finalize step). */
  softDeleted = 0;
  /** Last pagination cursor observed; null once the crawl finishes cleanly. */
  cursor: string | null = null;
  /**
   * Last global page number this segment reached (BRI-176) — threaded into
   * the *next* segment's `startPage` so R2 archive keys stay unique across
   * the whole run. `null` if this segment never saw a page (shouldn't
   * happen in practice, but a segment resuming past the crawl's real end
   * would see none).
   */
  lastPage: number | null = null;
  /**
   * Last non-null pagination cursor this segment observed — unlike `cursor`
   * (nulled once the crawl reaches its true end, the signal segment-worker
   * uses to know no more segments are needed), this never goes back to null
   * once set. Per Viator's ongoing-refresh contract, the cursor to resume a
   * *future* run from is the value returned by the second-to-last page —
   * exactly the last non-null cursor any segment ever saw (BRI-181). `null`
   * only when this segment's own pages never included one (e.g. its only
   * page was already the crawl's true, already-terminal last page) — see
   * `incrementData`'s guarded write in `increment-data.ts`, which is what
   * keeps that case from clobbering an already-persisted value on the row.
   */
  lastCursor: string | null = null;
}

/** Options for one segment of a run. */
export interface ImportPipelineOptions {
  /**
   * Provenance timestamp (ISO-8601) stamped on every row this segment
   * touches. Sourced from `ImportRun.startedAt` (BRI-176) rather than
   * computed locally, so every segment of one run — regardless of which
   * process ran it — stamps the identical value. That's what lets the last
   * segment reconstruct the whole run's incoming-id set straight from the
   * DB (`Tour` rows sharing this `fetchedAt`) instead of carrying an
   * in-memory list across process boundaries — see `segment-worker.cli.ts`.
   */
  readonly fetchedAt: string;
  /**
   * Optional ISO-8601 timestamp for a delta crawl (only pages modified since
   * then). Only meaningful — and only ever supplied by the caller — on a
   * run's very first segment; every resumed segment has `startCursor` set,
   * and {@link ViatorClient.fetchModifiedSince} already refuses to send
   * `modifiedSince` whenever a `startCursor` is present.
   */
  readonly modifiedSince?: string;
  /** Forwarded to each upsert transaction's timeout; see `upsert.ts`. */
  readonly transactionTimeoutMs?: number;
  /**
   * Stop after this many pages (BRI-176), leaving further pages for the
   * *next* segment (a fresh OS process — see class docstring) rather than
   * continuing in this one. Stops early only when a next page actually
   * exists; the crawl's true last page (no `nextCursor`) always finishes
   * the segment via natural completion instead. From
   * `IMPORT_CRAWL_RESTART_PAGES`.
   */
  readonly restartEveryNPages: number;
  /** Resume pagination from this cursor; omitted on a run's first segment. */
  readonly startCursor?: string;
  /** Resume page numbering from here; omitted on a run's first segment. */
  readonly startPage?: number;
}

/** Result of one {@link ImportPipeline.runSegment} call. */
export interface RunSegmentResult {
  /**
   * `true` once the crawl has reached its true end (no more pages) —
   * the caller should reconstruct `incomingIds` from the DB and call
   * `finalizeGuardedSoftDelete`/`ExperienceLinker` exactly once. `false`
   * means more pages remain; the caller should spawn another segment
   * resuming from `counts.cursor`.
   */
  readonly done: boolean;
}

export class ImportPipeline {
  private readonly logger = new Logger(ImportPipeline.name);

  constructor(
    private readonly client: ViatorClient,
    private readonly resolver: LocationResolver,
    private readonly priceResolver: PriceResolver,
    private readonly validator: TourValidator,
    private readonly upsert: TourUpsertService,
  ) {}

  /**
   * Run one bounded segment of a crawl, mutating `counts` as each stage
   * completes. Stops after `options.restartEveryNPages` pages or the crawl's
   * true end, whichever comes first — see class docstring for why this
   * method never loops or restarts internally. Does **not** call
   * `finalizeGuardedSoftDelete` or `ExperienceLinker`; the caller does that
   * exactly once, only when the returned `done` is `true`.
   *
   * Propagates whatever a stage throws — `counts` already holds every
   * stage's tally up to the failure point, so the caller can record an
   * accurate partial result even on failure.
   */
  async runSegment(
    counts: ImportRunCounts,
    options: ImportPipelineOptions,
  ): Promise<RunSegmentResult> {
    let skippedNotCurated = 0;
    let skippedInactive = 0;
    let skippedManualConfirmation = 0;
    const stats = new ImportRunStats();

    let done = true;
    let pagesThisSegment = 0;

    for await (const page of this.client.fetchModifiedSince({
      modifiedSince: options.modifiedSince,
      startCursor: options.startCursor,
      startPage: options.startPage,
      date: options.fetchedAt.slice(0, 10),
    })) {
      counts.fetched += page.products.length;
      counts.cursor = page.nextCursor ?? null;
      counts.lastPage = page.page;
      if (page.nextCursor) {
        counts.lastCursor = page.nextCursor;
      }

      // 1+2. Scope-filter + normalize this page (BRI-170/171): `page.products`
      //    goes out of scope at the end of this iteration, and `pageDtos`
      //    holds at most this page's curated survivors — never the whole
      //    crawl's. The normalizer throws on a product missing a required
      //    field (defence-in-depth); one bad product must not sink the whole
      //    nightly run, so it's skipped-and-logged rather than aborting.
      const pageDtos: TourDTO[] = [];
      for (const raw of page.products) {
        const scope = decideIngestScope(raw);
        if (!scope.ingest) {
          switch (scope.reason) {
            case "NOT_CURATED_DESTINATION":
              skippedNotCurated += 1;
              break;
            case "INACTIVE":
              skippedInactive += 1;
              break;
            case "MANUAL_CONFIRMATION":
              skippedManualConfirmation += 1;
              break;
          }
          continue;
        }

        try {
          pageDtos.push(
            normalizeViatorProduct(raw, { fetchedAt: options.fetchedAt }),
          );
          counts.normalized += 1;
        } catch (error) {
          this.logger.warn(
            `Skipping unnormalizable product: ${messageOf(error)}`,
          );
        }
      }

      if (pageDtos.length > 0) {
        // 3. Resolve start-location references to coordinates for this page
        //    (cached across runs and across pages within this run — see
        //    LocationResolver's persistent cache).
        const located = await this.resolver.attachLocations(pageDtos);

        // 3b. Resolve the "from" price per product from
        //     `/availability/schedules` (BRI-165), for this page's survivors
        //     only. BRI-170: bounded to this page's curated count (a small
        //     fraction of ≤500), never one call per product in Viator's
        //     entire global catalog, and never accumulated across the whole
        //     crawl before firing.
        const priced = await this.priceResolver.attachPrices(located);

        // 4. Validate this page. Passing tours proceed to this page's
        //    upsert; quarantined ones are persisted + counted by the
        //    validator via the shared stats tally, which spans this segment.
        const passing: TourDTO[] = [];
        for (const dto of priced) {
          const result = await this.validator.process(dto, stats);
          if (result.ok) passing.push(dto);
        }

        if (passing.length > 0) {
          // 5. Upsert this page's passing tours immediately — unconditional
          //    and safe (BRI-170: see upsert.ts's class docstring for why
          //    this doesn't wait for the mass-deletion guard).
          const batchResult = await this.upsert.upsertBatch(passing, {
            transactionTimeoutMs: options.transactionTimeoutMs,
          });
          counts.upserted += batchResult.upserted;
        }
      }

      // BRI-176: stop this segment every `restartEveryNPages` pages, leaving
      // the rest for a fresh process (see class docstring). Only when a next
      // page actually exists — the crawl's true last page (no `nextCursor`)
      // always finishes via natural completion instead, leaving `done` true.
      pagesThisSegment += 1;
      if (page.nextCursor && pagesThisSegment >= options.restartEveryNPages) {
        done = false;
        break;
      }
    }

    counts.quarantined = stats.quarantined;

    this.logger.log(
      `Segment scanned ${counts.fetched} product(s) from provider — ` +
        `${skippedNotCurated} outside curated destinations, ${skippedInactive} inactive, ` +
        `${skippedManualConfirmation} manual-confirmation — ` +
        `${counts.normalized} normalized into the curated ingest set.`,
    );

    return { done };
  }
}

/** Best-effort message extraction from an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
