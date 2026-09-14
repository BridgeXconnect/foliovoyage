import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../../app.module";
import { ExperienceAutoPromoter } from "./experience-auto-promoter";

/**
 * Standalone-context runner for {@link ExperienceAutoPromoter.promoteEligible}
 * (category/currency promotion plan, Task 9).
 *
 * The live pipeline already calls this on every import run
 * (`segment-worker.cli.ts`, Task 8), so this exists to sweep the provider's
 * full backlog on demand — e.g. immediately after Task 6's price backfill, so
 * rows that only just became eligible (a resolved `priceReferenceMinor`) get
 * promoted without waiting for the next nightly crawl to touch them.
 *
 * Usage (from the repo root, against the real DB — always via Doppler):
 *
 *   doppler run -- pnpm --filter @folio/api exec tsx src/modules/import/promote-eligible.cli.ts [--dry-run]
 *
 * `--dry-run` counts what would be promoted without writing anything.
 */
async function main(): Promise<void> {
  const logger = new Logger("promote-eligible");
  const dryRun = process.argv.includes("--dry-run");

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["log", "warn", "error"],
  });
  app.enableShutdownHooks();

  try {
    const promoter = app.get(ExperienceAutoPromoter);
    const result = await promoter.promoteEligible("viator", dryRun);

    logger.log(
      `${dryRun ? "[dry-run] " : ""}scanned ${result.scanned}, promoted ${result.promoted}.`,
    );
    console.log(JSON.stringify({ dryRun, ...result }, null, 2));
    process.exitCode = 0;
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
