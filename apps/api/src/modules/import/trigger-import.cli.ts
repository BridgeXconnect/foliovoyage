import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../../app.module";
import { ImportRunService } from "./import-run.service";

/**
 * Manual import trigger (ST-10 / BRI-107).
 *
 * The on-demand path the spec asks for: kick off a full import run without
 * waiting for the nightly cron, for testing or a one-off re-sync. It boots a
 * headless Nest application *context* (no HTTP listener), resolves the same
 * {@link ImportRunService} the scheduler uses, runs it with trigger `"manual"`,
 * prints the resulting `import_run` record, and exits.
 *
 * Because it reuses the wired pipeline, a manual run behaves identically to a
 * scheduled one — same stages, same guard, same record — it just starts on
 * demand. Run it from the repo root:
 *
 *   pnpm --filter @folio/api import:run
 *
 * Set `IMPORT_CRON_ENABLED=false` for the invocation if you don't also want the
 * nightly job registered in the short-lived context.
 */
async function main(): Promise<void> {
  const logger = new Logger("trigger-import");

  // Application *context* only — we don't want an HTTP server for a one-shot CLI.
  const app = await NestFactory.createApplicationContext(AppModule, {
    // Keep Nest's own bootstrap chatter down; our logs carry the signal.
    logger: ["log", "warn", "error"],
  });
  app.enableShutdownHooks();

  try {
    const runService = app.get(ImportRunService);
    logger.log("Triggering a manual import run…");
    const run = await runService.execute("manual");

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

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
