import { defineRailway, github, image, preserve, project, redis, service, volume } from "railway/iac";

/**
 * @folio/api — apps/api's NestJS HTTP server. No rootDirectory: the build
 * context stays at the monorepo root deliberately. A scoped rootDirectory
 * hides the root package.json's "packageManager": "pnpm@11.1.3" field and
 * pnpm-lock.yaml from Railway's builder (Railpack), which then falls back to
 * plain `npm install` and the build command's `pnpm` isn't provisioned at
 * all — confirmed 2026-09-04, first real deploy failed at BUILD_IMAGE with
 * `sh: 1: pnpm: not found` after rootDirectory: "apps/api" hid those files.
 * The build/start commands already scope to the API via `pnpm --filter
 * @folio/api`, so root-level build context is what they need anyway.
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
  // Postgres storage volume — declared separately so the service below can
  // attach it by name. See the service()-vs-database() note on `postgres`.
  const postgresVolume = volume("postgres-volume", {
    sizeMB: 5000,
    region: "iad",
  });

  // Managed Postgres, but on the postgis/postgis image (not Railway's plain
  // postgres template) — apps/api's Prisma schema needs the postgis and
  // pg_trgm extensions (see infra/docker-compose.yml, the local-dev
  // equivalent, and infra/postgres/init/*.sql which CREATE EXTENSION-s them
  // on first boot). Root-caused 2026-09-04: the HEALTHCHECK-failing
  // deployment's DatabaseModule/Redis warnings traced to Doppler's prd
  // DATABASE_URL/REDIS_URL holding leftover localhost dev values with
  // nothing real behind them — these two resources are what those Doppler
  // values now need to point at (Roy copies the real connection strings
  // from each resource's Railway variables tab into Doppler by hand; this
  // file never carries secret literals, see the preserve() note below).
  //
  // Declared as service(), not database(): database() with a custom `image`
  // still provisions a plain Railway service under the hood (confirmed
  // live, 2026-09-04 — the actual resource landed at address
  // "service.Postgres", type "service"), but database()'s own IaC node
  // expects a "database"-typed resource at that address. That mismatch made
  // `railway config plan` treat the already-running, already-provisioned
  // Postgres as a different resource from the one it wanted, planning a
  // destructive delete-and-recreate on every subsequent apply. Declaring it
  // as service() with the image/mount/env shape that matches what's
  // actually live keeps the state diff clean. Redis doesn't hit this: it
  // uses the built-in redis() factory below with no custom image, which
  // really does provision as a native "database"-typed resource.
  const postgres = service("Postgres", {
    source: image("postgis/postgis:16-3.4"),
    deploy: {
      requiredMountPath: "/var/lib/postgresql/data",
    },
    networking: {
      privateNetworkEndpoint: "postgres",
    },
    volumeMounts: {
      "/var/lib/postgresql/data": postgresVolume,
    },
    // PGDATA points at a fresh subdir, not the volume's data root: the
    // first (timed-out) apply had already created this resource on
    // Railway's default template image (ghcr.io/railwayapp-templates/
    // postgres-ssl:18 — confirmed via deployment history), which ran
    // initdb and wrote a postgresql.conf containing PG18-only settings
    // (autovacuum_worker_slots) into the volume. The second apply then
    // swapped the image to postgis:16-3.4 but reused that same volume, so
    // PG16 crash-looped trying to parse a PG18 config file (FATAL:
    // configuration file "postgresql.conf" contains errors). Repointing
    // PGDATA at an empty subdirectory (set live via the Railway MCP
    // set-variables tool, 2026-09-04) makes postgis:16-3.4's entrypoint
    // treat it as uninitialized and run initdb fresh — the orphaned PG18
    // files under pgdata/ are harmless and left in place.
    env: {
      DATABASE_URL: preserve(),
      PGDATA: preserve(),
      PGDATABASE: preserve(),
      PGHOST: preserve(),
      PGPASSWORD: preserve(),
      PGPORT: preserve(),
      PGUSER: preserve(),
      POSTGRES_DB: preserve(),
      POSTGRES_PASSWORD: preserve(),
      POSTGRES_USER: preserve(),
      SSL_CERT_DAYS: preserve(),
      RAILWAY_DEPLOYMENT_DRAINING_SECONDS: preserve(),
    },
  });

  const cache = redis("Redis");

  const api = service("@folio/api", {
    source: github("BridgeXconnect/foliovoyage", {
      branch: "master",
    }),
    build: "pnpm --filter @folio/api build",
    start: "pnpm --filter @folio/api start",
    // Matches the live auto-generated value — declaring it stops
    // `railway config plan` from repeatedly proposing to reset this to
    // null on every apply (harmless each time, but noisy).
    networking: {
      privateNetworkEndpoint: "folioapi",
    },
    healthcheck: "/ready",
    healthcheckTimeout: 30,
    env: {
      NODE_ENV: preserve(),
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

  // Nightly import cron — same source/build as @folio/api, but a distinct
  // service so the cron trigger runs as a scheduled one-off invocation
  // instead of sharing the always-on HTTP process (see Task 4 in
  // docs/superpowers/plans/2026-09-04-render-to-railway-migration.md).
  // Originally provisioned entirely via the Railway MCP tools, outside this
  // file — that Task 4 note said cron scheduling "is not expressible in
  // .railway/railway.ts's DSL", which was wrong (or true of an older CLI):
  // the installed railway@3.11.0 package's DeployConfig type does support
  // `cronSchedule`/`restartPolicyType`. Left undeclared, `railway config
  // plan` treats this service as unmanaged and proposes deleting it on
  // every apply — declaring it here (matching the live config exactly, via
  // `railway config plan`, 2026-09-05) is what stops that.
  const cron = service("@folio/api-cron", {
    source: github("BridgeXconnect/foliovoyage", {
      branch: "master",
    }),
    build: "pnpm --filter @folio/api build",
    start: "pnpm --filter @folio/api exec node dist/modules/import/trigger-import.cli.js",
    deploy: {
      cronSchedule: "0 3 * * *",
      restartPolicyType: "NEVER",
    },
    networking: {
      privateNetworkEndpoint: "folioapi-cron",
    },
    env: {
      NODE_ENV: preserve(),
      DATABASE_URL: preserve(),
      REDIS_URL: preserve(),
      VIATOR_API_KEY: preserve(),
      VIATOR_API_BASE_URL: preserve(),
      VIATOR_API_LANGUAGE: preserve(),
      R2_ENDPOINT: preserve(),
      R2_BUCKET: preserve(),
      R2_ACCESS_KEY_ID: preserve(),
      R2_SECRET_ACCESS_KEY: preserve(),
      IMPORT_CRON_ENABLED: preserve(),
      IMPORT_MEMORY_LIMIT_MB: preserve(),
      IMPORT_CRAWL_RESTART_MEMORY_PCT: preserve(),
    },
  });

  return project("striking-smile", {
    resources: [api, cron, postgres, cache, postgresVolume],
  });
});
