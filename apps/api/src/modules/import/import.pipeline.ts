import { Logger } from "@nestjs/common";

import type { ViatorClient } from "./clients/viator.client";
import type { ViatorProduct } from "./clients/viator.types";
import type { ExperienceLinker } from "./experience-linker";
import type { LocationResolver } from "./location-resolver";
import { normalizeViatorProduct, type TourDTO } from "./normalizer";
import type { PriceResolver } from "./price-resolver";
import type { TourUpsertService } from "./upsert";
import { ImportRunStats, type TourValidator } from "./validator";

/**
 * Import pipeline orchestrator (ST-10 / BRI-107).
 *
 * Threads the existing, already-merged stages together, straight through, into
 * one synchronous run:
 *
 *   ST-6 {@link ViatorClient} (fetch + archive)
 *     → ST-7 {@link normalizeViatorProduct} (normalize)
 *     → ST-7b {@link LocationResolver} (resolve start coordinates)
 *     → ST-7c {@link PriceResolver} (resolve "from" price from schedules)
 *     → ST-8 {@link TourValidator} (validate / quarantine)
 *     → ST-9 {@link TourUpsertService} (idempotent upsert + soft-delete + guard)
 *     → ST-11 {@link ExperienceLinker} (auto-create/link draft Experiences)
 *
 * M1 is deliberately synchronous: this is a single straight-line call, **no
 * queue and no worker** (that is ST-33 in M6). The orchestrator adds no counting
 * or validation logic of its own — it only wires the stages and threads the
 * counts each stage already reports into a caller-owned {@link ImportRunCounts}.
 *
 * That counts object is passed *in* and mutated as the run progresses, so it
 * reflects the work done **even when a later stage throws**. In particular, when
 * ST-9's mass-deletion guard trips (`MassDeletionAbortError`), `fetched`,
 * `normalized`, and `quarantined` are already final by the time the upsert
 * rolls back, so the caller (ST-10's run record) can persist them against an
 * `aborted` run rather than losing them.
 */

/** Mutable per-run tally, owned by the caller and threaded through the run. */
export class ImportRunCounts {
  /** Raw products pulled from the provider (ST-6). */
  fetched = 0;
  /** Products that normalized to a DTO without error (ST-7). */
  normalized = 0;
  /** Tours quarantined by the validator (ST-8). */
  quarantined = 0;
  /** Rows inserted or updated in the live catalogue (ST-9). */
  upserted = 0;
  /** Rows soft-deleted this run (ST-9). */
  softDeleted = 0;
  /** Draft Experiences auto-created this run (ST-11). */
  experiencesCreated = 0;
  /** Tours newly linked to an Experience this run (ST-11). */
  experiencesLinked = 0;
  /** Last pagination cursor observed; null once the crawl finishes cleanly. */
  cursor: string | null = null;
}

/** Options for one pipeline run. */
export interface ImportPipelineOptions {
  /**
   * Mass-deletion abort threshold (0–100), forwarded verbatim to
   * {@link TourUpsertService.upsertRun}. Supplied from `DELETE_GUARD_THRESHOLD_PCT`.
   */
  readonly deleteGuardThresholdPct: number;
  /**
   * Optional ISO-8601 timestamp for a delta crawl (only pages modified since
   * then). Omitted for a full crawl — the nightly default.
   */
  readonly modifiedSince?: string;
  /** Forwarded to the upsert transaction timeout; see {@link TourUpsertService}. */
  readonly transactionTimeoutMs?: number;
}

export class ImportPipeline {
  private readonly logger = new Logger(ImportPipeline.name);

  constructor(
    private readonly client: ViatorClient,
    private readonly resolver: LocationResolver,
    private readonly priceResolver: PriceResolver,
    private readonly validator: TourValidator,
    private readonly upsert: TourUpsertService,
    private readonly linker: ExperienceLinker,
  ) {}

  /**
   * Run the whole pipeline once, mutating `counts` as each stage completes.
   *
   * Resolves on a committed upsert. Propagates whatever a stage throws — most
   * importantly {@link import("./upsert").MassDeletionAbortError} from the guard
   * — after `counts` already holds every stage's tally up to the failure point,
   * so the caller can record an accurate partial result.
   */
  async run(
    counts: ImportRunCounts,
    options: ImportPipelineOptions,
  ): Promise<void> {
    // One crawl timestamp for the whole run — the provenance the normalizer
    // needs (it is pure and never reads the clock itself).
    const fetchedAt = new Date().toISOString();

    // 1. Fetch every page to completion (the ST-9 diff needs the full set to
    //    decide soft-deletes, so we can't stream straight into the upsert).
    const rawProducts: ViatorProduct[] = [];
    for await (const page of this.client.fetchModifiedSince({
      modifiedSince: options.modifiedSince,
    })) {
      rawProducts.push(...page.products);
      counts.fetched = rawProducts.length;
      counts.cursor = page.nextCursor ?? null;
    }
    this.logger.log(`Fetched ${counts.fetched} product(s) from provider.`);

    // 2. Normalize. The normalizer throws on a product missing a required field
    //    (defence-in-depth); one bad product must not sink the whole nightly
    //    run, so we skip-and-log it rather than aborting.
    const dtos: TourDTO[] = [];
    for (const raw of rawProducts) {
      try {
        dtos.push(normalizeViatorProduct(raw, { fetchedAt }));
        counts.normalized += 1;
      } catch (error) {
        this.logger.warn(
          `Skipping unnormalizable product: ${messageOf(error)}`,
        );
      }
    }

    // 3. Resolve start-location references to coordinates (cached across runs).
    const located = await this.resolver.attachLocations(dtos);

    // 3b. Resolve the "from" price per product from `/availability/schedules`
    //     (BRI-165). The product payload carries no price, and the validator
    //     quarantines priceless tours, so without this every real import is
    //     quarantined. Unresolved tours stay null-priced and are quarantined.
    const priced = await this.priceResolver.attachPrices(located);

    // 4. Validate. Passing tours proceed to upsert; quarantined ones are
    //    persisted + counted by the validator via the shared stats tally.
    const stats = new ImportRunStats();
    const passing: TourDTO[] = [];
    for (const dto of priced) {
      const result = await this.validator.process(dto, stats);
      if (result.ok) passing.push(dto);
    }
    counts.quarantined = stats.quarantined;

    // 5. Upsert + soft-delete + mass-deletion guard, transactionally. Throws
    //    MassDeletionAbortError if the guard trips — nothing is committed, and
    //    upserted/softDeleted stay 0 by virtue of not being reassigned.
    const result = await this.upsert.upsertRun(passing, {
      deleteGuardThresholdPct: options.deleteGuardThresholdPct,
      transactionTimeoutMs: options.transactionTimeoutMs,
    });
    counts.upserted = result.upserted;
    counts.softDeleted = result.softDeleted;

    // 6. Link imported tours to draft Experiences (ST-11 / BRI-164). Runs after
    //    the upsert commits, on the committed catalogue — so it links this run's
    //    rows plus any curated-city tour left unlinked by an earlier run. It
    //    operates on one provider; a run crawls one OTA (upsert enforces this).
    const provider = passing[0]?.provider ?? "viator";
    const link = await this.linker.linkRun(provider);
    counts.experiencesCreated = link.created;
    counts.experiencesLinked = link.linked;
  }
}

/** Best-effort message extraction from an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
