import { Logger } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";

import type { TourDTO } from "./normalizer";

/**
 * Idempotent upsert + soft-delete + mass-deletion abort guard (ST-9 / BRI-106).
 *
 * This is the last stage of the ingest pipeline and the single most
 * safety-critical one in M1: it writes to the **live catalogue** (`tours`), so
 * two properties are non-negotiable.
 *
 * 1. **Idempotency.** A run is keyed on each row's immutable
 *    `(provider, providerTourId)` pair. Re-running the same import updates rows
 *    in place and creates nothing new — running twice yields the same table as
 *    running once.
 * 2. **Safety against a bad upstream.** A tour that was active in the DB but is
 *    absent from this run is **soft-deleted** (`deletedAt` set), never hard
 *    deleted. And before any soft-delete is committed, a guard checks what share
 *    of the active catalogue the run would remove: if it exceeds
 *    `DELETE_GUARD_THRESHOLD_PCT`, the **entire run aborts** — a truncated or
 *    failed upstream fetch must never be able to wipe the catalogue.
 *
 * The whole operation — read active set, diff, upsert, soft-delete — runs inside
 * **one transaction**. Either all of it lands or none of it does; a failure part
 * way through leaves the catalogue exactly as it was.
 */

/** Thrown when the mass-deletion guard trips. Aborts the whole run. */
export class MassDeletionAbortError extends Error {
  constructor(
    /** Provider whose catalogue the run targeted. */
    readonly provider: string,
    /** Rows currently active (deletedAt IS NULL) for this provider. */
    readonly activeCount: number,
    /** Rows this run would have soft-deleted. */
    readonly wouldDeleteCount: number,
    /** The share the run would delete, as a percentage (0–100). */
    readonly deletionPct: number,
    /** The configured threshold it exceeded, as a percentage (0–100). */
    readonly thresholdPct: number,
  ) {
    super(
      `Mass-deletion guard tripped for provider "${provider}": run would ` +
        `soft-delete ${wouldDeleteCount}/${activeCount} active tours ` +
        `(${deletionPct.toFixed(2)}%), exceeding the ${thresholdPct}% ` +
        `threshold. Aborting the entire run — no upserts or soft-deletes ` +
        `were committed.`,
    );
    this.name = "MassDeletionAbortError";
  }
}

/**
 * The result of diffing this run against the active catalogue, before anything
 * is written. Pure data — computed by {@link planDeletion} with no DB access, so
 * the guard arithmetic is unit-testable in isolation.
 */
export interface DeletionPlan {
  /** `providerTourId`s active in the DB but absent from this run. */
  readonly toSoftDelete: string[];
  /** Rows currently active (deletedAt IS NULL) for this provider. */
  readonly activeCount: number;
  /** Share of the active catalogue this run would soft-delete, as % (0–100). */
  readonly deletionPct: number;
  /** Whether the guard trips: the run must abort without writing anything. */
  readonly aborted: boolean;
}

/**
 * Diff the run's set of provider tour ids against the active catalogue and
 * decide whether the mass-deletion guard trips. **Pure** — no DB, no clock, no
 * network.
 *
 * The guard aborts only when there is an active catalogue to protect
 * (`activeCount > 0`) and the run would remove **strictly more** than
 * `thresholdPct` of it. Consequences of the edge cases, made explicit:
 * - **First run** (`activeCount === 0`): `deletionPct` is 0, never aborts — a
 *   fresh catalogue has nothing to wipe.
 * - **Empty run against a populated catalogue**: deletes 100%, always aborts
 *   (for any threshold < 100) — this is the exact "upstream returned nothing"
 *   failure the guard exists to catch.
 *
 * @param activeIds  `providerTourId`s currently active for the provider.
 * @param incomingIds  `providerTourId`s present in this run.
 * @param thresholdPct  Abort above this percentage (0–100).
 */
export function planDeletion(
  activeIds: Iterable<string>,
  incomingIds: Iterable<string>,
  thresholdPct: number,
): DeletionPlan {
  const incoming = new Set(incomingIds);
  const active = new Set(activeIds);

  const toSoftDelete: string[] = [];
  for (const id of active) {
    if (!incoming.has(id)) toSoftDelete.push(id);
  }

  const activeCount = active.size;
  const deletionPct =
    activeCount === 0 ? 0 : (toSoftDelete.length / activeCount) * 100;
  const aborted = activeCount > 0 && deletionPct > thresholdPct;

  return { toSoftDelete, activeCount, deletionPct, aborted };
}

/** Result of upserting one batch (typically one page's curated survivors). */
export interface UpsertBatchResult {
  /** Rows inserted or updated by this batch. */
  readonly upserted: number;
}

/** How long the whole read+diff+upsert+soft-delete transaction may run. */
const DEFAULT_TRANSACTION_TIMEOUT_MS = 120_000;

/** Options for one `upsertBatch` call. */
export interface UpsertBatchOptions {
  /**
   * Interactive-transaction timeout in milliseconds for this batch's
   * transaction. A batch is one page's worth of curated survivors (small), so
   * the default is generous headroom, not a tuned value — unlike the old
   * single-transaction `upsertRun`, no batch here should ever approach it.
   * Defaults to {@link DEFAULT_TRANSACTION_TIMEOUT_MS}.
   */
  readonly transactionTimeoutMs?: number;
}

/** Result of the once-per-run guarded soft-delete finalize step. */
export interface FinalizeSoftDeleteResult {
  /** Rows soft-deleted this run. */
  readonly softDeleted: number;
  /** Active-catalogue size that the soft-delete share was measured against. */
  readonly activeCountBefore: number;
}

/** Options for {@link TourUpsertService.finalizeGuardedSoftDelete}. */
export interface FinalizeSoftDeleteOptions {
  /**
   * Abort threshold as a percentage (0–100). Supplied from
   * `DELETE_GUARD_THRESHOLD_PCT`; injected per-call so the guard is testable
   * without touching env.
   */
  readonly deleteGuardThresholdPct: number;
  /** Timeout for the finalize transaction (read active + diff + soft-delete). */
  readonly transactionTimeoutMs?: number;
}

/**
 * Anything with the `$transaction` + `tour` surface this service needs — i.e. a
 * `PrismaClient` or the {@link PrismaService} subclass. Kept structural so tests
 * can pass a real client pointed at a throwaway database.
 */
export type TourUpsertPrisma = Pick<PrismaClient, "$transaction" | "tour">;

/**
 * Persists tours to the live catalogue (ST-9 / BRI-106, restructured by
 * BRI-170 into two calls instead of one).
 *
 * **BRI-170.** The pipeline used to accumulate *every* curated survivor across
 * an entire crawl before calling this service once, so the mass-deletion guard
 * could gate the whole write set behind one all-or-nothing transaction. That
 * accumulation is exactly what OOM'd Render's 512MiB instance twice. The fix
 * (see `import.pipeline.ts`) is to upsert each page's survivors as they're
 * found, which means the guard can no longer gate the upserts themselves —
 * they're already committed by the time a "whole run" guard check could run.
 * So the guard's scope narrows to what it can still meaningfully protect: the
 * **soft-delete** step, which is the actually-destructive operation a
 * truncated/broken upstream fetch could trigger. Two methods reflect this
 * split:
 *
 * - {@link upsertBatch} — call once per page. Upserts are unconditional:
 *   idempotent, and safe regardless of how the rest of the run goes, because
 *   they only ever touch rows the run actually saw.
 * - {@link finalizeGuardedSoftDelete} — call once, after the whole crawl
 *   finishes, with every `provider_tour_id` any `upsertBatch` call upserted
 *   this run. Diffs that against the live active catalogue (via the unchanged,
 *   pure {@link planDeletion}) and soft-deletes what's active-but-absent,
 *   unless the guard trips — in which case *only the soft-delete* rolls back.
 */
export class TourUpsertService {
  private readonly logger = new Logger(TourUpsertService.name);

  constructor(private readonly prisma: TourUpsertPrisma) {}

  /**
   * Upsert every tour in `tours` in one small transaction. No diff, no guard,
   * no soft-delete — this call only ever creates or updates rows the run
   * actually saw, which is safe unconditionally. Intended to be called once
   * per page (or small batch) as a crawl proceeds.
   *
   * All tours in one call must share a `provider` (a run crawls one OTA); the
   * provider is taken from the first row. An empty `tours` array is a no-op.
   */
  async upsertBatch(
    tours: TourDTO[],
    options: UpsertBatchOptions = {},
  ): Promise<UpsertBatchResult> {
    if (tours.length === 0) return { upserted: 0 };

    const provider = tours[0].provider;
    for (const tour of tours) {
      if (tour.provider !== provider) {
        throw new Error(
          `upsertBatch received tours from multiple providers ` +
            `("${provider}" and "${tour.provider}"); a batch must be single-provider.`,
        );
      }
    }

    await this.prisma.$transaction(
      async (tx) => {
        for (const tour of tours) {
          const data = toColumns(tour);
          await tx.tour.upsert({
            where: {
              provider_providerTourId: {
                provider: tour.provider,
                providerTourId: tour.provider_tour_id,
              },
            },
            create: data,
            update: { ...data, deletedAt: null },
          });
        }
      },
      { timeout: options.transactionTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS },
    );

    this.logger.log(
      `Upserted batch of ${tours.length} tour(s) for provider "${provider}".`,
    );
    return { upserted: tours.length };
  }

  /**
   * Every `providerTourId` for `provider` whose `fetchedAt` exactly matches
   * `fetchedAt` (BRI-176) — i.e. every row any segment of one run touched.
   * Read-only; does not affect `upsertBatch` or the guard below at all.
   *
   * Exists because a run can now span several `segment-worker.cli.ts`
   * processes (BRI-176), so the "every id this run upserted" list
   * {@link finalizeGuardedSoftDelete} needs can no longer be accumulated in
   * one process's memory across the whole run. Every segment of a run stamps
   * the *same* `fetchedAt` (`ImportRun.startedAt`, passed to
   * `ImportPipeline.runSegment` — see that class's docstring) on every row
   * it touches, so this query reconstructs the exact same set an in-memory
   * accumulator would have held, straight from the DB.
   */
  async findUpsertedIds(provider: string, fetchedAt: Date): Promise<string[]> {
    const rows = await this.prisma.tour.findMany({
      where: { provider, fetchedAt },
      select: { providerTourId: true },
    });
    return rows.map((r) => r.providerTourId);
  }

  /**
   * Diff `incomingIds` (every `provider_tour_id` this run upserted, across
   * every `upsertBatch` call) against the live active catalogue for
   * `provider`, and soft-delete anything active-but-absent — guarded by the
   * mass-deletion threshold, in one transaction. Call once, after the whole
   * crawl finishes.
   *
   * @throws {MassDeletionAbortError} if the guard trips. Only the soft-delete
   *   transaction rolls back; any `upsertBatch` calls already made this run
   *   remain committed (see the class docstring for why).
   */
  async finalizeGuardedSoftDelete(
    incomingIds: string[],
    provider: string,
    options: FinalizeSoftDeleteOptions,
  ): Promise<FinalizeSoftDeleteResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const active = await tx.tour.findMany({
          where: { provider, deletedAt: null },
          select: { providerTourId: true },
        });
        const activeIds = active.map((r) => r.providerTourId);

        const plan = planDeletion(
          activeIds,
          incomingIds,
          options.deleteGuardThresholdPct,
        );

        if (plan.aborted) {
          this.logger.error(
            `ABORT: import for provider "${provider}" would soft-delete ` +
              `${plan.toSoftDelete.length}/${plan.activeCount} active tours ` +
              `(${plan.deletionPct.toFixed(2)}%), over the ` +
              `${options.deleteGuardThresholdPct}% guard threshold. This run's ` +
              `upserts already committed per-page (BRI-170) — only this ` +
              `soft-delete step is being rolled back.`,
          );
          throw new MassDeletionAbortError(
            provider,
            plan.activeCount,
            plan.toSoftDelete.length,
            plan.deletionPct,
            options.deleteGuardThresholdPct,
          );
        }

        if (plan.toSoftDelete.length > 0) {
          await tx.tour.updateMany({
            where: {
              provider,
              providerTourId: { in: plan.toSoftDelete },
              deletedAt: null,
            },
            data: { deletedAt: new Date() },
          });
        }

        this.logger.log(
          `Finalized provider "${provider}": soft-deleted ` +
            `${plan.toSoftDelete.length} of ${plan.activeCount} active ` +
            `(${plan.deletionPct.toFixed(2)}%).`,
        );

        return {
          softDeleted: plan.toSoftDelete.length,
          activeCountBefore: plan.activeCount,
        };
      },
      { timeout: options.transactionTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS },
    );
  }
}

/**
 * Map the provider-owned + provenance slice of a {@link TourDTO} onto the `Tour`
 * columns. Atlas-owned fields are never written here (ingest doesn't own them),
 * so this is a straight, total projection.
 */
function toColumns(tour: TourDTO): Prisma.TourCreateInput {
  return {
    provider: tour.provider,
    providerTourId: tour.provider_tour_id,
    title: tour.title,
    description: tour.description,
    durationMin: tour.duration_min,
    ratingAvg: tour.rating_avg,
    ratingCount: tour.rating_count,
    priceMinor: tour.price_minor,
    currency: tour.currency,
    priceReferenceMinor: tour.price_reference_minor,
    priceReferenceCurrency: tour.price_reference_currency,
    affiliateUrl: tour.affiliate_url,
    locationRef: tour.location_ref,
    latitude: tour.latitude,
    longitude: tour.longitude,
    imageUrl: tour.image_url,
    imageAlt: tour.image_alt,
    images: tour.images as unknown as Prisma.InputJsonValue,
    destinationRefs: tour.destination_refs,
    tags: tour.tags,
    fetchedAt: new Date(tour.fetched_at),
    sourceHash: tour.source_hash,
  };
}
