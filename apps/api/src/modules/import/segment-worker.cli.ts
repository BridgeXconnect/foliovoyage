import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";

import type { Env } from "../../config/env.validation";
import { PrismaService } from "../../prisma/prisma.service";
import { ExperienceLinker } from "./experience-linker";
import { ImportSegmentWorkerModule } from "./import-segment-worker.module";
import { ImportPipeline, ImportRunCounts } from "./import.pipeline";
import { MassDeletionAbortError, TourUpsertService } from "./upsert";

/**
 * Segment-worker (BRI-176) — the disposable child process
 * {@link import("./import-run.service").ImportRunService} spawns once per
 * crawl segment.
 *
 * Boots a headless, *minimal* Nest application context
 * ({@link ImportSegmentWorkerModule} — deliberately not the full `AppModule`
 * `trigger-import.cli.ts` uses; see that module's docstring for why),
 * resumes the given run from its persisted `cursor`/`lastPage`, runs exactly
 * one bounded {@link ImportPipeline.runSegment}, persists this segment's
 * counts as increments on the `ImportRun` row, and — only when that segment
 * reports the crawl is truly done — reconstructs the whole run's incoming-id
 * set from the DB and runs the once-per-run finalize steps
 * (`finalizeGuardedSoftDelete`, `ExperienceLinker`) itself, since it's the
 * one process that knows the run just finished.
 *
 * Exits 0 whenever it successfully recorded *some* outcome for this
 * invocation — a completed segment with more pages left, a fully finished
 * run (succeeded/aborted), or a caught mid-segment failure — since the row's
 * `status` is what carries the real business outcome, not the exit code.
 * Only exits non-zero (via the uncaught top-level `catch`) when something
 * went wrong before any outcome could be written at all; the parent treats
 * that (or a `null` exit code from an OS-delivered signal, e.g. an OOM kill)
 * as reason to finalize the run itself.
 *
 * Run directly for manual testing:
 *
 *   node dist/modules/import/segment-worker.cli.js --runId <id>
 */
async function main(): Promise<void> {
  const logger = new Logger("segment-worker");
  const { runId, modifiedSince } = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(
    ImportSegmentWorkerModule,
    { logger: ["log", "warn", "error"] },
  );
  app.enableShutdownHooks();

  try {
    const prisma = app.get(PrismaService);
    const pipeline = app.get(ImportPipeline);
    const upsert = app.get(TourUpsertService);
    const linker = app.get(ExperienceLinker);
    const config = app.get(ConfigService<Env, true>);

    const run = await prisma.importRun.findUniqueOrThrow({
      where: { id: runId },
    });

    const counts = new ImportRunCounts();
    let segmentDone: boolean;
    try {
      const result = await pipeline.runSegment(counts, {
        fetchedAt: run.startedAt.toISOString(),
        // modified-since only ever matters on a run's very first segment —
        // every resumed one already has a cursor, and ViatorClient itself
        // refuses to send modified-since whenever startCursor is set (see
        // that class's docstring), so this is a belt-and-suspenders guard,
        // not the only thing preventing both being sent together.
        modifiedSince: run.cursor == null ? modifiedSince : undefined,
        restartEveryNPages: config.get("IMPORT_CRAWL_RESTART_PAGES", {
          infer: true,
        }),
        startCursor: run.cursor ?? undefined,
        startPage: run.lastPage ?? undefined,
      });
      segmentDone = result.done;
    } catch (error) {
      // Mid-segment failure (e.g. the client's own retry budget exhausted).
      // `counts` still holds this segment's real partial progress up to the
      // failure — persist it as increments, same as a clean segment would,
      // then record the run as failed.
      await prisma.importRun.update({
        where: { id: runId },
        data: {
          ...incrementData(counts),
          status: "failed",
          error: messageOf(error),
          finishedAt: new Date(),
        },
      });
      logger.error(`Import run ${runId} failed: ${messageOf(error)}`);
      return;
    }

    await prisma.importRun.update({
      where: { id: runId },
      data: incrementData(counts),
    });

    if (!segmentDone) {
      logger.log(
        `Segment of run ${runId} finished with more pages remaining ` +
          `(cursor persisted for the next segment).`,
      );
      return;
    }

    // This segment reached the crawl's true end — finalize the whole run,
    // exactly once, reconstructing every id any segment upserted from the
    // DB (see TourUpsertService.findUpsertedIds's docstring for why).
    const incomingIds = await upsert.findUpsertedIds(
      run.provider,
      run.startedAt,
    );
    try {
      const deletion = await upsert.finalizeGuardedSoftDelete(
        incomingIds,
        run.provider,
        {
          deleteGuardThresholdPct: config.get("DELETE_GUARD_THRESHOLD_PCT", {
            infer: true,
          }),
        },
      );
      const link = await linker.linkRun(run.provider);
      await prisma.importRun.update({
        where: { id: runId },
        data: {
          status: "succeeded",
          softDeleted: deletion.softDeleted,
          finishedAt: new Date(),
        },
      });
      logger.log(
        `Import run ${runId} succeeded — experiences created ${link.created}, ` +
          `linked ${link.linked}.`,
      );
    } catch (error) {
      if (error instanceof MassDeletionAbortError) {
        await prisma.importRun.update({
          where: { id: runId },
          data: { status: "aborted", error: error.message, finishedAt: new Date() },
        });
        logger.warn(
          `Import run ${runId} aborted by mass-deletion guard: ${error.message}`,
        );
      } else {
        await prisma.importRun.update({
          where: { id: runId },
          data: {
            status: "failed",
            error: messageOf(error),
            finishedAt: new Date(),
          },
        });
        logger.error(`Import run ${runId} failed: ${messageOf(error)}`);
      }
    }
  } finally {
    await app.close();
  }
}

/** Increment expressions for one segment's counts, safe to apply repeatedly. */
function incrementData(counts: ImportRunCounts) {
  return {
    fetched: { increment: counts.fetched },
    normalized: { increment: counts.normalized },
    quarantined: { increment: counts.quarantined },
    upserted: { increment: counts.upserted },
    cursor: counts.cursor,
    ...(counts.lastPage !== null ? { lastPage: counts.lastPage } : {}),
  };
}

function parseArgs(argv: string[]): {
  runId: string;
  modifiedSince?: string;
} {
  let runId: string | undefined;
  let modifiedSince: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--runId") runId = argv[i + 1];
    if (argv[i] === "--modifiedSince") modifiedSince = argv[i + 1];
  }
  if (!runId) {
    throw new Error("segment-worker.cli.ts requires --runId <id>");
  }
  return { runId, modifiedSince };
}

/** Best-effort message extraction from an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void main().catch((error) => {
  // Nothing could be recorded at all — the parent sees this as a non-zero
  // exit and finalizes the run itself.
  console.error(error);
  process.exitCode = 1;
});
