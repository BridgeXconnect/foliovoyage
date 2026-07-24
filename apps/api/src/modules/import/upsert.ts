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

/** Summary returned to the caller (ST-10 orchestrator) after a committed run. */
export interface UpsertRunResult {
  /** Rows inserted or updated (i.e. every row in the run). */
  readonly upserted: number;
  /** Rows soft-deleted this run (active before, absent now). */
  readonly softDeleted: number;
  /** Active-catalogue size that the soft-delete share was measured against. */
  readonly activeCountBefore: number;
}

/** How long the whole read+diff+upsert+soft-delete transaction may run. */
const DEFAULT_TRANSACTION_TIMEOUT_MS = 120_000;

/** Options for a single upsert run. */
export interface UpsertRunOptions {
  /**
   * Abort threshold as a percentage (0–100). Supplied from
   * `DELETE_GUARD_THRESHOLD_PCT`; injected per-call so the guard is testable
   * without touching env.
   */
  readonly deleteGuardThresholdPct: number;
  /**
   * Interactive-transaction timeout in milliseconds. The whole run is one
   * transaction, so a full-catalogue crawl (thousands of upserts) needs far more
   * than Prisma's 5s default — otherwise a legitimate large run would time out
   * and roll back. Defaults to {@link DEFAULT_TRANSACTION_TIMEOUT_MS}.
   */
  readonly transactionTimeoutMs?: number;
}

/**
 * Anything with the `$transaction` + `tour` surface this service needs — i.e. a
 * `PrismaClient` or the {@link PrismaService} subclass. Kept structural so tests
 * can pass a real client pointed at a throwaway database.
 */
export type TourUpsertPrisma = Pick<PrismaClient, "$transaction" | "tour">;

/**
 * Persists a run of validated tours to the live catalogue, transactionally.
 *
 * Not a pure function: it owns the DB writes. The guard *arithmetic* it defers
 * to {@link planDeletion} (pure, unit-tested); this class owns wrapping the
 * read + diff + upsert + soft-delete in one transaction and turning a tripped
 * guard into a rollback.
 */
export class TourUpsertService {
  private readonly logger = new Logger(TourUpsertService.name);

  constructor(private readonly prisma: TourUpsertPrisma) {}

  /**
   * Upsert every tour in `tours` and soft-delete anything active-but-absent, in
   * a single transaction, guarded against mass deletion.
   *
   * All tours in one call must share a `provider` (a run crawls one OTA); the
   * provider is taken from the first row. An empty run still executes: it
   * upserts nothing but *does* diff, so it will trip the guard against a
   * populated catalogue rather than silently soft-deleting everything.
   *
   * @throws {MassDeletionAbortError} if the guard trips — the transaction rolls
   *   back, so nothing (no upsert, no soft-delete) is committed.
   */
  async upsertRun(
    tours: TourDTO[],
    options: UpsertRunOptions,
  ): Promise<UpsertRunResult> {
    const provider = tours[0]?.provider ?? "viator";
    // A malformed run mixing providers would corrupt the per-provider diff.
    for (const tour of tours) {
      if (tour.provider !== provider) {
        throw new Error(
          `upsertRun received tours from multiple providers ` +
            `("${provider}" and "${tour.provider}"); a run must be single-provider.`,
        );
      }
    }

    const incomingIds = tours.map((t) => t.provider_tour_id);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // 1. Snapshot the active catalogue for this provider (inside the txn, so
      //    the diff is consistent with the writes that follow).
      const active = await tx.tour.findMany({
        where: { provider, deletedAt: null },
        select: { providerTourId: true },
      });
      const activeIds = active.map((r) => r.providerTourId);

      // 2. Diff + guard (pure).
      const plan = planDeletion(
        activeIds,
        incomingIds,
        options.deleteGuardThresholdPct,
      );

      if (plan.aborted) {
        // Log/alert clearly with the actual percentage vs. threshold, then throw
        // to roll the transaction back — nothing is committed.
        this.logger.error(
          `ABORT: import for provider "${provider}" would soft-delete ` +
            `${plan.toSoftDelete.length}/${plan.activeCount} active tours ` +
            `(${plan.deletionPct.toFixed(2)}%), over the ` +
            `${options.deleteGuardThresholdPct}% guard threshold. ` +
            `Rolling back — no changes committed.`,
        );
        throw new MassDeletionAbortError(
          provider,
          plan.activeCount,
          plan.toSoftDelete.length,
          plan.deletionPct,
          options.deleteGuardThresholdPct,
        );
      }

      // 3. Upsert each row on its natural key. A reappearing (previously
      //    soft-deleted) tour is revived by clearing deletedAt on update.
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

      // 4. Soft-delete everything active-but-absent, in one statement.
      if (plan.toSoftDelete.length > 0) {
        await tx.tour.updateMany({
          where: {
            provider,
            providerTourId: { in: plan.toSoftDelete },
            deletedAt: null,
          },
          data: { deletedAt: now },
        });
      }

      this.logger.log(
        `Import for provider "${provider}": upserted ${tours.length}, ` +
          `soft-deleted ${plan.toSoftDelete.length} of ${plan.activeCount} ` +
          `active (${plan.deletionPct.toFixed(2)}%).`,
      );

      return {
        upserted: tours.length,
        softDeleted: plan.toSoftDelete.length,
        activeCountBefore: plan.activeCount,
      };
    }, { timeout: options.transactionTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS });
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
    affiliateUrl: tour.affiliate_url,
    locationRef: tour.location_ref,
    latitude: tour.latitude,
    longitude: tour.longitude,
    fetchedAt: new Date(tour.fetched_at),
    sourceHash: tour.source_hash,
  };
}
