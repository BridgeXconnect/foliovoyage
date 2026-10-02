import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { setDbRetryProfile } from "../../prisma/transient-retry";
import { ImportRunService, type ImportRunTrigger } from "./import-run.service";

/**
 * Import trigger CLI (ST-10 / BRI-107, `--trigger` added in BRI-232).
 *
 * The entry point for both on-demand runs and the Railway `@folio/api-cron`
 * service (`.railway/railway.ts`). It kicks off a full import run, for the
 * nightly schedule, for testing, or for a one-off re-sync. It boots a headless
 * Nest application *context* (no HTTP listener), resolves the same
 * {@link ImportRunService} the in-process scheduler uses, runs it, prints the
 * resulting `import_run` record, and exits.
 *
 * `--trigger scheduled|manual` sets the `trigger` recorded on the run
 * (default `manual`, so `pnpm --filter @folio/api import:run` is unchanged).
 * The Railway cron service passes `--trigger scheduled` so its nightly runs
 * are labelled as cron-initiated rather than manual.
 *
 * Because it reuses the wired pipeline, a manual run behaves identically to a
 * scheduled one — same stages, same guard, same record — it just starts on
 * demand. Run it from the repo root:
 *
 *   pnpm --filter @folio/api import:run
 *
 * `import:run` builds first and runs the compiled `dist/` output rather than
 * using `ts-node`, on purpose: {@link import("./segment-runner").NodeSegmentRunner} spawns each segment as
 * a plain `node` child pointed at the sibling `segment-worker.cli.js`, which
 * only exists once compiled (and a plain `node` child has no `ts-node`
 * loader). Run under `ts-node`, the child dies with MODULE_NOT_FOUND and the
 * run is recorded as failed with nothing fetched.
 *
 * Set `IMPORT_CRON_ENABLED=false` for the invocation if you don't also want the
 * nightly job registered in the short-lived context.
 */
export const USAGE = "Usage: trigger-import [--trigger scheduled|manual]";

const TRIGGERS: readonly ImportRunTrigger[] = ["scheduled", "manual"];

export function parseArgs(argv: readonly string[]): { trigger: ImportRunTrigger } | { error: string } {
  let trigger: ImportRunTrigger = "manual";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--trigger") {
      const raw = argv[++i];
      const match = TRIGGERS.find((t) => t === raw);
      if (!match) {
        return { error: `--trigger needs one of: ${TRIGGERS.join(", ")}. Got ${raw ?? "(nothing)"}.\n${USAGE}` };
      }
      trigger = match;
    } else {
      return { error: `Unknown argument "${arg}".\n${USAGE}` };
    }
  }
  return { trigger };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(args.error);
    process.exitCode = 2;
    return;
  }

  // BRI-210: long-running batch job, so ride out transient DB drops.
  setDbRetryProfile("import");
  const logger = new Logger("trigger-import");

  // Loaded here rather than at the top of the file: AppModule's import runs env
  // validation, which a bad-args exit (or a test importing parseArgs) must not need.
  const { AppModule } = await import("../../app.module");

  // Application *context* only — we don't want an HTTP server for a one-shot CLI.
  const app = await NestFactory.createApplicationContext(AppModule, {
    // Keep Nest's own bootstrap chatter down; our logs carry the signal.
    logger: ["log", "warn", "error"],
  });
  app.enableShutdownHooks();

  try {
    const runService = app.get(ImportRunService);
    logger.log(`Triggering a ${args.trigger} import run…`);
    const run = await runService.execute(args.trigger);

    // The record is the deliverable — print it so a human/CI can eyeball the
    // status and counts without querying the DB.
    logger.log(`Import run finished with status "${run.status}".`);
    console.log(JSON.stringify(run, null, 2));

    // A guard-abort or failure is a non-zero exit so a caller/CI can react.
    process.exitCode = run.status === "succeeded" ? 0 : 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
