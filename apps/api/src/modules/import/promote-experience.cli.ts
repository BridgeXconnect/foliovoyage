import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../../app.module";
import { setDbRetryProfile } from "../../prisma/transient-retry";
import {
  ExperienceNotFoundError,
  ExperiencePromoter,
} from "./promote-experience.service";

/**
 * Promote an Experience to `published` (BRI-164 / ST-11).
 *
 * ⚠️  This is NOT Admin review. Real editorial review — the M7 Admin surface
 * where a human vets an auto-created Experience before it goes live — does not
 * exist yet. This command is the deliberate, scriptable stand-in for it: it
 * flips exactly one Experience from `draft` to `published` so a curated city
 * page has something to show. When the real review flow lands, this becomes an
 * internal step of that flow, not the front door. Treat a call to it as "an
 * operator consciously published this", nothing more.
 *
 * Usage (from the repo root):
 *
 *   pnpm --filter @folio/api experience:promote <experienceId>
 *
 * Exit code is 0 on success (including an already-published no-op) and 1 on a
 * bad/missing id, so it is safe to script.
 */
async function main(): Promise<void> {
  // BRI-210: long-running batch job, so ride out transient DB drops.
  setDbRetryProfile("import");
  const logger = new Logger("promote-experience");

  const id = process.argv[2]?.trim();
  if (!id) {
    console.error(
      "Usage: pnpm --filter @folio/api experience:promote <experienceId>\n\n" +
        "Promotes one Experience from draft to published. This is a manual " +
        "stand-in for Admin review (M7), which does not exist yet — not the " +
        "real review flow.",
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["log", "warn", "error"],
  });
  app.enableShutdownHooks();

  try {
    const promoter = app.get(ExperiencePromoter);
    const result = await promoter.promote(id);
    if (result.changed) {
      logger.log(`Published Experience ${result.id} ("${result.title}").`);
    } else {
      logger.log(
        `Experience ${result.id} ("${result.title}") was already published.`,
      );
    }
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 0;
  } catch (error) {
    if (error instanceof ExperienceNotFoundError) {
      logger.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
