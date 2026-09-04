import { defineRailway, github, preserve, project, service } from "railway/iac";

/**
 * @folio/api — apps/api's NestJS HTTP server. rootDirectory scopes the build
 * to apps/api even though the CLI checks out the full monorepo (confirmed via
 * Railway's own documented monorepo example: pnpm --filter commands work
 * fine against the full workspace lockfile from a scoped rootDirectory).
 *
 * Every secret is declared as preserve() rather than a literal value — the
 * real values live in Doppler (project foliovoyage, config prd) and sync in
 * via Doppler's native Railway integration (see docs/superpowers/plans/
 * 2026-09-04-render-to-railway-migration.md Task 3), not through this file.
 * preserve() tells `railway config apply` "this variable exists, keep
 * whatever value is already set on Railway" instead of deleting it for not
 * being declared with a literal value.
 */
export default defineRailway(() => {
  const api = service("@folio/api", {
    source: github("BridgeXconnect/foliovoyage", {
      rootDirectory: "apps/api",
      branch: "master",
    }),
    build: "pnpm --filter @folio/api build",
    start: "pnpm --filter @folio/api start",
    healthcheck: "/ready",
    healthcheckTimeout: 30,
    env: {
      DATABASE_URL: preserve(),
      REDIS_URL: preserve(),
      VIATOR_API_KEY: preserve(),
      VIATOR_API_BASE_URL: preserve(),
      VIATOR_API_LANGUAGE: preserve(),
      VIATOR_REQUEST_TIMEOUT_MS: preserve(),
      R2_ENDPOINT: preserve(),
      R2_BUCKET: preserve(),
      R2_ACCESS_KEY_ID: preserve(),
      R2_SECRET_ACCESS_KEY: preserve(),
      DELETE_GUARD_THRESHOLD_PCT: preserve(),
      IMPORT_CRON_SCHEDULE: preserve(),
      IMPORT_CRON_ENABLED: preserve(),
      IMPORT_STUCK_RUN_TIMEOUT_MINUTES: preserve(),
      IMPORT_CRAWL_RESTART_PAGES: preserve(),
      IMPORT_MEMORY_LIMIT_MB: preserve(),
      IMPORT_CRAWL_RESTART_MEMORY_PCT: preserve(),
      INTERNAL_CLICK_SECRET: preserve(),
      IP_HASH_SALT: preserve(),
    },
  });

  return project("striking-smile", {
    resources: [api],
  });
});
