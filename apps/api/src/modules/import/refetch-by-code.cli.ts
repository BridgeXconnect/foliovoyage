import { readFile } from "node:fs/promises";

import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";

import type { Env } from "../../config/env.validation";
import { PrismaService } from "../../prisma/prisma.service";
import { setDbRetryProfile } from "../../prisma/transient-retry";
import {
  REFETCH_ARCHIVE_SOURCE,
  VIATOR_BULK_MAX_CODES,
  ViatorClient,
} from "./clients/viator.client";
import { ImportRunService } from "./import-run.service";
import { ImportPipeline, ImportRunCounts } from "./import.pipeline";
import {
  R2RawArchiveReader,
  type RawArchiveReader,
} from "./storage/raw-archive.reader";
import { ImportRunStats } from "./validator";

/**
 * `refetch-by-code:run [--codes-file PATH] [--dry-run] [--limit N]
 * [--batch-size N] [--refreshed-after ISO]` (BRI-227).
 *
 * One-off repair: re-fetch the live tours stuck on the pre-14-Sep schema (no
 * tags, gallery or inclusions/exclusions; the nightly delta never re-reports
 * them) by product code, through Viator's by-code endpoint, and push the
 * results through the *existing* archive → normalize → upsert path
 * (`ImportPipeline.processProducts`, the same stage chain a crawled page runs).
 *
 * Why not a full crawl: BRI-185 (a no-cursor run hit end-of-feed after ~10K
 * products), BRI-184 (`cursorAtStart = null` triggers deletion reconciliation)
 * and a full crawl moves the delta cursor.
 *
 * What this CLI never does, by construction (it imports none of that code):
 * - create, read, advance or reset the delta cursor (`ImportRun.lastCursor`);
 * - run deletion reconciliation or soft-delete anything. Codes Viator does not
 *   return, rejects as invalid or reports INACTIVE are logged and counted only;
 * - be classified as a full crawl by the BRI-184 logic (`cursorAtStart`).
 *
 * **No `ImportRun` row is written, on purpose.** Do not "fix" this. An
 * `ImportRun` means "a catalogue crawl". A manual row with no crawl semantics
 * would pollute the run history and the observability work in BRI-233 (run
 * counts, durations and cursor lineage would all read it as a crawl). Skipping
 * the row adds zero risk; the stdout summary is the record (copy it to Linear).
 *
 * Cohort (default, no `--codes-file`): every live (`deletedAt IS NULL`) Viator
 * tour with `fetchedAt` strictly before `--refreshed-after` (default
 * 2026-09-15T00:00:00Z). There is deliberately no lower bound: an earlier
 * [2026-08-31, ...) window skipped the ~40 live tours fetched 19-30 Aug, which
 * lack tags, gallery and inclusions/exclusions just like the rest. No live tour
 * fetched on or after 15 Sep lacks tags, so the cutoff alone separates stale
 * from healthy.
 * "Stale" has one definition everywhere: `fetchedAt < --refreshed-after`. A
 * successful upsert stamps `fetchedAt` with this run's start time, which is at
 * or after that threshold, so a re-run skips rows it already refreshed. That is
 * the resume mechanism, for the default cohort query and for `--codes-file`
 * alike.
 *
 * `--codes-file`: one product code per line (blank lines and `#` comments
 * ignored); only the live, still-stale codes among them are fetched. Used to
 * test on dev, whose rows are all newer than the window: pass a
 * `--refreshed-after` taken just before the run.
 *
 * Safety nets: refuses to start while an `ImportRun` is `running`
 * (`ImportRunService.hasRunningRun`); `--dry-run` selects and reports but makes
 * no Viator call and no write; the upsert only ever touches rows it fetched.
 * An upsert clears `deletedAt`, so codes that are soft-deleted (or unknown)
 * are never fetched in the first place.
 *
 * Archives: each response body is stored as returned (a bare array) at
 * `raw/viator-refetch/{date}/{n}.json`, `n` the numeric batch index, so the
 * BRI-218 coordinate backfill can read it with `--source viator-refetch`.
 *
 * Run the compiled build, never ts-node (the Nest module graph and the
 * segment worker are built for `dist/`):
 *
 *   pnpm --filter @folio/api build
 *   doppler run --config dev -- node apps/api/dist/modules/import/refetch-by-code.cli.js --dry-run
 *
 * Exit codes: 0 ok, 1 bad arguments or a failure (partial work is kept, re-run
 * to resume), 2 refused to start because an import is running.
 */

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

/** Default `--refreshed-after`: rows fetched before this are stale (exclusive, no lower bound). */
export const DEFAULT_REFRESHED_AFTER = new Date("2026-09-15T00:00:00.000Z");

const PROVIDER = "viator";
const MAX_LISTED_CODES = 200;
const CODE_RE = /^[A-Za-z0-9_-]{1,40}$/;

export const USAGE =
  "Usage: refetch-by-code [--codes-file PATH] [--dry-run] [--limit N] " +
  `[--batch-size N (1-${VIATOR_BULK_MAX_CODES}, default ${VIATOR_BULK_MAX_CODES})] ` +
  "[--refreshed-after ISO-8601 (default 2026-09-15T00:00:00Z)]";

export interface RefetchArgs {
  codesFile: string | null;
  dryRun: boolean;
  limit: number | null;
  batchSize: number;
  refreshedAfter: Date;
}

export function parseArgs(
  argv: readonly string[],
  now: Date = new Date(),
): RefetchArgs | { error: string } {
  const args: RefetchArgs = {
    codesFile: null,
    dryRun: false,
    limit: null,
    batchSize: VIATOR_BULK_MAX_CODES,
    refreshedAfter: DEFAULT_REFRESHED_AFTER,
  };
  const positiveInt = (flag: string, raw: string | undefined, max = Infinity): number | string => {
    const value = raw === undefined ? NaN : Number(raw);
    return Number.isInteger(value) && value >= 1 && value <= max
      ? value
      : `${flag} needs an integer from 1 to ${max === Infinity ? "any" : max}, got ${raw ?? "(nothing)"}.\n${USAGE}`;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--codes-file") {
      const raw = argv[++i];
      if (!raw) return { error: `--codes-file needs a path.\n${USAGE}` };
      args.codesFile = raw;
    } else if (arg === "--limit" || arg === "--batch-size") {
      const value = positiveInt(arg, argv[++i], arg === "--batch-size" ? VIATOR_BULK_MAX_CODES : Infinity);
      if (typeof value === "string") return { error: value };
      if (arg === "--limit") args.limit = value;
      else args.batchSize = value;
    } else if (arg === "--refreshed-after") {
      const raw = argv[++i];
      const at = raw ? new Date(raw) : new Date(NaN);
      if (Number.isNaN(at.getTime())) {
        return { error: `--refreshed-after needs an ISO-8601 timestamp, got ${raw ?? "(nothing)"}.\n${USAGE}` };
      }
      // A threshold in the future would make rows this run refreshes (stamped
      // with its start time) still look stale, so every re-run would refetch them.
      if (at.getTime() > now.getTime()) {
        return { error: `--refreshed-after ${at.toISOString()} is in the future; use the time this run starts or earlier.` };
      }
      args.refreshedAfter = at;
    } else {
      return { error: `Unknown argument "${arg}".\n${USAGE}` };
    }
  }
  return args;
}

/** One product code per line; blanks and `#` comments ignored; deduped in order. */
export function parseCodesFile(text: string): string[] | { error: string } {
  const codes: string[] = [];
  const seen = new Set<string>();
  const bad: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const code = line.replace(/#.*$/, "").trim();
    if (code === "") continue;
    if (!CODE_RE.test(code)) {
      bad.push(code);
      continue;
    }
    if (!seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }
  if (bad.length > 0) {
    return { error: `Codes file has ${bad.length} malformed line(s), e.g. ${JSON.stringify(bad.slice(0, 3))}.` };
  }
  return codes;
}

// --- seams ------------------------------------------------------------------

export interface QuarantineStats {
  rows: number;
  /** `COUNT(DISTINCT providerTourId)`. The store is create-only, so rows can repeat a code. */
  distinctCodes: number;
}

export interface CodeClassification {
  /** Live and `fetchedAt < refreshedAfter`: to be fetched. */
  stale: string[];
  /** Live and `fetchedAt >= refreshedAfter`: a previous run already refreshed it. */
  alreadyRefreshed: string[];
  /** Absent, or soft-deleted. Never fetched: an upsert would clear `deletedAt`. */
  notLive: string[];
}

export interface RefetchStore {
  /** `ImportRunService.hasRunningRun()`. */
  hasRunningRun(): Promise<boolean>;
  /** Default cohort, ordered by code: live and `fetchedAt < refreshedAfter`. */
  selectCohort(refreshedAfter: Date): Promise<string[]>;
  classifyCodes(codes: readonly string[], refreshedAfter: Date): Promise<CodeClassification>;
  quarantineStats(): Promise<QuarantineStats>;
}

export interface RefetchDeps {
  store: RefetchStore;
  client: Pick<ViatorClient, "fetchProductsByCode">;
  pipeline: Pick<ImportPipeline, "processProducts">;
  /** First free numeric batch index for `date` under `raw/viator-refetch/`. */
  nextBatchIndex: (date: string) => Promise<number>;
  readFile?: (path: string) => Promise<string>;
  now?: () => Date;
}

// --- main -------------------------------------------------------------------

interface Tally {
  requested: number;
  returned: number;
  notReturned: string[];
  rejectedInvalid: string[];
  unresolved: string[];
  inactive: number;
  notCurated: number;
  manualConfirmation: number;
  unnormalizable: number;
  quarantined: number;
  upserted: number;
  batchesArchived: number;
  archiveKeys: string[];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const EXIT_REFUSED = 2;

export async function main(
  argv: readonly string[],
  io: CliIo,
  deps: RefetchDeps,
): Promise<number> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const args = parseArgs(argv, startedAt);
  if ("error" in args) {
    io.err(args.error);
    return 1;
  }
  const { store, client, pipeline } = deps;
  const mode = args.dryRun ? "DRY RUN, nothing is fetched or written" : "EXECUTE, this will change Tour rows";
  io.out(`refetch-by-code (${mode})`);

  const running = await store.hasRunningRun();
  if (running && !args.dryRun) {
    io.err("Refusing to start: an ImportRun is in status 'running'. Wait for it to finish (or mark an orphaned row failed) and retry.");
    return EXIT_REFUSED;
  }
  if (running) io.out("  Note: an ImportRun is 'running'; a real run would refuse to start.");

  // 1. Select.
  let stale: string[];
  let fileCodes: string[] | null = null;
  if (args.codesFile !== null) {
    const text = await (deps.readFile ?? ((p) => readFile(p, "utf8")))(args.codesFile);
    const parsed = parseCodesFile(text);
    if (!Array.isArray(parsed)) {
      io.err(parsed.error);
      return 1;
    }
    fileCodes = parsed;
    const classified = await store.classifyCodes(parsed, args.refreshedAfter);
    stale = classified.stale;
    io.out(
      `  Codes file: ${parsed.length} code(s): ${classified.stale.length} stale, ` +
        `${classified.alreadyRefreshed.length} already refreshed (skipped), ${classified.notLive.length} not live (skipped).`,
    );
  } else {
    stale = await store.selectCohort(args.refreshedAfter);
    io.out(
      `  Cohort: ${stale.length} live tour(s) fetched before ${args.refreshedAfter.toISOString()}.`,
    );
  }
  const selected = args.limit === null ? stale : stale.slice(0, args.limit);
  if (args.limit !== null) io.out(`  --limit ${args.limit}: ${selected.length} of ${stale.length} selected.`);
  const batches = chunk(selected, args.batchSize);
  io.out(`  ${selected.length} code(s) in ${batches.length} batch(es) of up to ${args.batchSize}.`);

  const quarantineBefore = await store.quarantineStats();
  io.out(`  QuarantinedTour before: ${quarantineBefore.rows} row(s), ${quarantineBefore.distinctCodes} distinct code(s).`);

  if (args.dryRun) {
    io.out(`  First codes: ${selected.slice(0, 10).join(", ") || "(none)"}`);
    io.out("\nDry run: no Viator call, no archive write, no database write.");
    return 0;
  }

  // 2. Fetch → archive → normalize → upsert, one batch at a time.
  const fetchedAt = startedAt.toISOString();
  const date = fetchedAt.slice(0, 10);
  const counts = new ImportRunCounts();
  const stats = new ImportRunStats();
  const tally: Tally = {
    requested: 0, returned: 0, notReturned: [], rejectedInvalid: [], unresolved: [], inactive: 0, notCurated: 0,
    manualConfirmation: 0, unnormalizable: 0, quarantined: 0, upserted: 0, batchesArchived: 0, archiveKeys: [],
  };
  let failure: string | null = null;
  let batchIndex = batches.length > 0 ? await deps.nextBatchIndex(date) : 1;

  for (const [position, codes] of batches.entries()) {
    try {
      const result = await client.fetchProductsByCode(codes, { batch: batchIndex, date });
      if (result.archive) {
        batchIndex += 1; // one index per successful (archived) request
        tally.batchesArchived += 1;
        tally.archiveKeys.push(result.archive.key);
      }
      const returnedCodes = new Set(
        result.products.map((p) => p.productCode).filter((c): c is string => typeof c === "string"),
      );
      const rejected = new Set(result.rejectedCodes);
      const unresolved = new Set(result.unresolvedCodes);
      const missing = codes.filter(
        (code) => !returnedCodes.has(code) && !rejected.has(code) && !unresolved.has(code),
      );
      tally.unresolved.push(...result.unresolvedCodes);
      tally.requested += codes.length;
      tally.returned += result.products.length;
      tally.rejectedInvalid.push(...result.rejectedCodes);
      tally.notReturned.push(...missing);

      const processed = await pipeline.processProducts(result.products, counts, stats, { fetchedAt });
      tally.inactive += processed.skippedInactive;
      tally.notCurated += processed.skippedNotCurated;
      tally.manualConfirmation += processed.skippedManualConfirmation;
      tally.unnormalizable += processed.unnormalizableCodes.length;
      tally.quarantined += processed.quarantinedCodes.length;
      tally.upserted += processed.upsertedCodes.length;
      io.out(
        `  batch ${position + 1}/${batches.length}: requested ${codes.length}, returned ${result.products.length}, ` +
          `not returned ${missing.length}, invalid ${result.rejectedCodes.length}, unresolved ${result.unresolvedCodes.length}, upserted ${processed.upsertedCodes.length}`,
      );
    } catch (error) {
      failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
      io.err(`  batch ${position + 1}/${batches.length} failed: ${failure}`);
      break;
    }
  }

  // 3. Report.
  const quarantineAfter = await store.quarantineStats();
  const remaining =
    fileCodes === null
      ? (await store.selectCohort(args.refreshedAfter)).length
      : (await store.classifyCodes(fileCodes, args.refreshedAfter)).stale.length;
  const wallSeconds = (now().getTime() - startedAt.getTime()) / 1000;
  const listed = (codes: readonly string[]): string =>
    codes.length === 0
      ? "none"
      : codes.slice(0, MAX_LISTED_CODES).join(",") + (codes.length > MAX_LISTED_CODES ? ` …and ${codes.length - MAX_LISTED_CODES} more` : "");
  const unrefreshed =
    tally.notReturned.length + tally.rejectedInvalid.length + tally.unresolved.length + tally.inactive + tally.notCurated +
    tally.manualConfirmation + tally.unnormalizable + tally.quarantined;

  io.out("\nSummary");
  io.out(`  fetchedAt stamp:           ${fetchedAt}`);
  io.out(`  selected:                  ${selected.length}`);
  io.out(`  fetched (codes requested): ${tally.requested}`);
  io.out(`  returned by Viator:        ${tally.returned}`);
  io.out(`  not returned:              ${tally.notReturned.length}  (logged, never deleted)`);
  io.out(`  invalid:                   ${tally.rejectedInvalid.length}  (400 Invalid product code; logged, never deleted)`);
  io.out(`  unresolved:                ${tally.unresolved.length}  (batch 400 not attributable to a code; logged, never deleted)`);
  io.out(`  returned but not ingested: inactive ${tally.inactive}, not curated ${tally.notCurated}, manual-confirmation ${tally.manualConfirmation}, unnormalizable ${tally.unnormalizable}`);
  io.out(`  archived:                  ${tally.batchesArchived} batch object(s) under raw/${REFETCH_ARCHIVE_SOURCE}/${date}/`);
  io.out(`  upserted:                  ${tally.upserted}`);
  io.out(`  newly quarantined codes:   ${tally.quarantined}`);
  io.out(`  QuarantinedTour before:    ${quarantineBefore.rows} rows / ${quarantineBefore.distinctCodes} distinct codes`);
  io.out(`  QuarantinedTour after:     ${quarantineAfter.rows} rows / ${quarantineAfter.distinctCodes} distinct codes`);
  io.out(`  cohort remaining:          ${remaining}  (this run left ${unrefreshed} returned-or-requested code(s) unrefreshed${failure ? ", plus the unfetched rest after a failure" : ""})`);
  io.out(`  not returned codes:        ${listed(tally.notReturned)}`);
  io.out(`  invalid codes:             ${listed(tally.rejectedInvalid)}`);
  io.out(`  unresolved codes:          ${listed(tally.unresolved)}`);
  io.out(`  wall time:                 ${wallSeconds.toFixed(1)}s`);
  if (failure) {
    io.err("\nFailed part-way; completed batches are kept. Re-run to resume.");
    return 1;
  }
  return 0;
}

// --- production wiring --------------------------------------------------------

type PrismaForRefetch = Pick<PrismaService, "tour" | "quarantinedTour" | "importRun">;

export function createPrismaRefetchStore(prisma: PrismaForRefetch): RefetchStore {
  // `hasRunningRun` is the only thing taken from ImportRunService; it never
  // executes a run, so a segment runner that always throws proves it.
  const runService = new ImportRunService(
    prisma as ConstructorParameters<typeof ImportRunService>[0],
    {
      runSegment: () => {
        throw new Error("refetch-by-code must never run an import segment");
      },
    },
    { provider: PROVIDER },
  );
  const staleWhere = (refreshedAfter: Date) => ({
    provider: PROVIDER,
    deletedAt: null,
    fetchedAt: { lt: refreshedAfter },
  });
  return {
    hasRunningRun: () => runService.hasRunningRun(),
    selectCohort: async (refreshedAfter) =>
      (
        await prisma.tour.findMany({
          where: staleWhere(refreshedAfter),
          select: { providerTourId: true },
          orderBy: { providerTourId: "asc" },
        })
      ).map((row) => row.providerTourId),
    classifyCodes: async (codes, refreshedAfter) => {
      const found = new Map<string, { fetchedAt: Date; deletedAt: Date | null }>();
      for (const part of chunk(codes, 1000)) {
        const rows = await prisma.tour.findMany({
          where: { provider: PROVIDER, providerTourId: { in: part } },
          select: { providerTourId: true, fetchedAt: true, deletedAt: true },
        });
        for (const row of rows) found.set(row.providerTourId, row);
      }
      const out: CodeClassification = { stale: [], alreadyRefreshed: [], notLive: [] };
      for (const code of codes) {
        const row = found.get(code);
        if (!row || row.deletedAt !== null) out.notLive.push(code);
        else if (row.fetchedAt >= refreshedAfter) out.alreadyRefreshed.push(code);
        else out.stale.push(code);
      }
      out.stale.sort();
      return out;
    },
    quarantineStats: async () => ({
      rows: await prisma.quarantinedTour.count(),
      distinctCodes: (
        await prisma.quarantinedTour.findMany({
          distinct: ["providerTourId"],
          select: { providerTourId: true },
        })
      ).length,
    }),
  };
}

/** First batch index not yet used for `date` under `raw/viator-refetch/`. */
export async function nextBatchIndexFrom(
  reader: Pick<RawArchiveReader, "listPageKeys">,
  date: string,
): Promise<number> {
  const keys = await reader.listPageKeys(REFETCH_ARCHIVE_SOURCE);
  const used = keys
    .map((key) => /^raw\/[^/]+\/(\d{4}-\d{2}-\d{2})\/(\d+)\.json$/.exec(key))
    .filter((m): m is RegExpExecArray => m !== null && m[1] === date)
    .map((m) => Number(m[2]));
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}

async function bootstrap(): Promise<number> {
  // BRI-210: long-running batch job, so ride out transient DB drops.
  setDbRetryProfile("import");
  // Loaded lazily: the module graph validates env at import time, which the
  // unit tests (that only exercise `main` through seams) must not trigger.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ImportSegmentWorkerModule } = require("./import-segment-worker.module") as typeof import("./import-segment-worker.module");
  const app = await NestFactory.createApplicationContext(ImportSegmentWorkerModule, {
    logger: ["log", "warn", "error"],
  });
  try {
    const config = app.get(ConfigService<Env, true>);
    const reader = new R2RawArchiveReader({
      endpoint: config.get("R2_ENDPOINT", { infer: true }),
      bucket: config.get("R2_BUCKET", { infer: true }),
      accessKeyId: config.get("R2_ACCESS_KEY_ID", { infer: true }),
      secretAccessKey: config.get("R2_SECRET_ACCESS_KEY", { infer: true }),
    });
    return await main(
      process.argv.slice(2),
      { out: (line) => console.log(line), err: (line) => console.error(line) },
      {
        store: createPrismaRefetchStore(app.get(PrismaService)),
        client: app.get(ViatorClient),
        pipeline: app.get(ImportPipeline),
        nextBatchIndex: (date) => nextBatchIndexFrom(reader, date),
      },
    );
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  bootstrap().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      new Logger("refetch-by-code").error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      process.exitCode = 1;
    },
  );
}
