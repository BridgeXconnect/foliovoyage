import type { ConfigService } from "@nestjs/config";

import type { Env } from "../../config/env.validation";

/**
 * Converts the BRI-182 `IMPORT_MEMORY_LIMIT_MB` / `IMPORT_CRAWL_RESTART_MEMORY_PCT`
 * env vars into the absolute `rss` byte threshold `ImportPipeline.runSegment`
 * checks against — see those vars' docstrings in `env.validation.ts` for the
 * evidence behind their defaults.
 *
 * Kept in its own file, separate from `segment-worker.cli.ts`, so it can be
 * unit-tested without pulling in `ImportSegmentWorkerModule` — that module's
 * `ConfigModule.forRoot({ validate: validateEnv })` runs synchronously at
 * import time (inside the `@Module(...)` decorator's argument evaluation,
 * before any test gets a chance to run), so importing `segment-worker.cli.ts`
 * itself crashes outside a fully-configured process env.
 */
export function memoryThresholdBytes(config: ConfigService<Env, true>): number {
  const limitMb = config.get("IMPORT_MEMORY_LIMIT_MB", { infer: true });
  const pct = config.get("IMPORT_CRAWL_RESTART_MEMORY_PCT", { infer: true });
  return Math.floor(limitMb * 1024 * 1024 * (pct / 100));
}
