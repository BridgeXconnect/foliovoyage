# apps/api

## Overview

`@folio/api` — NestJS API (modular monolith), the backend for Folio Voyage
(Atlas), built module by module alongside `apps/web`. It is the intended
long-term source of truth for destination/tour data via its ingest pipeline;
see root [AGENTS.md](../../AGENTS.md) "Two content systems in transition" for
how that relates to `apps/web`'s static content.

## Commands

Run from the repo root.

```bash
doppler run -- pnpm --filter @folio/api dev

# Tests (jest, specs live next to source as *.spec.ts)
pnpm --filter @folio/api test
pnpm --filter @folio/api exec jest src/modules/import/normalizer.spec.ts   # single file
pnpm --filter @folio/api exec jest -t "test name"                          # single test
pnpm --filter @folio/api test:integration                                  # separate jest.integration.config.js

# Local backing services (Postgres w/ PostGIS+pg_trgm, Redis)
docker compose -f infra/docker-compose.yml up -d

# Prisma
pnpm --filter @folio/api exec prisma migrate dev     # create/apply a migration locally
pnpm --filter @folio/api exec prisma generate        # regenerate client (also runs on postinstall)
pnpm --filter @folio/api prisma:seed                 # seed via prisma/seed.ts

# Import CLIs
pnpm --filter @folio/api import:run                  # manually trigger an import run (builds first: the segment worker is spawned from dist/, not ts-node)
pnpm --filter @folio/api experience:promote <id>      # promote one draft Experience to published by id (manual; the automatic path is ExperienceAutoPromoter, below)

# One off sweeps over the real DB (not in package.json; always via Doppler, both take --dry-run)
doppler run -- pnpm --filter @folio/api exec ts-node src/modules/import/backfill-reference-price.cli.ts   # fill Tour.priceReferenceMinor for rows ingested before it existed
doppler run -- pnpm --filter @folio/api exec ts-node src/modules/import/promote-eligible.cli.ts            # promote every draft Experience that is now eligible
```

## Deployment — Railway

`apps/api` runs on Railway (project `striking-smile`), not Render — migrated
2026-09 (see `docs/superpowers/plans/2026-09-04-render-to-railway-migration.md`
for the full migration plan and rationale). Two services in one environment:

- `@folio/api` — the HTTP server, config-as-code via `.railway/railway.ts`.
  Deliberately no scoped `rootDirectory`: the build context stays at the
  monorepo root, or Railway's builder can't see the root `pnpm-lock.yaml` /
  `packageManager` field and falls back to plain `npm install` (see the
  file's own comment). Health-gated on `/ready` (real DB+Redis dependency
  check, not the bare `/health` liveness probe).
- `@folio/api-cron` — runs the compiled import CLI
  (`dist/modules/import/trigger-import.cli.js`) on Railway's native cron
  schedule (`0 3 * * *` UTC), configured directly via the Railway MCP/CLI
  since cron scheduling is not yet expressible in `.railway/railway.ts`.

Both services share one set of environment variables synced from Doppler's
native Railway integration (project `foliovoyage`, config `prd`) at the
environment level — set up from the Doppler dashboard, not committed
anywhere in this repo.

`apps/web`'s `API_BASE_URL` points at `@folio/api`'s Railway domain — see
that env var in Vercel's project settings, not this repo, for the current value.

## Conventions

- **Config**: `src/config/env.validation.ts` is the single source of truth for
  the env surface — a Zod schema validated once at boot via
  `ConfigModule.forRoot({ validate })`. Missing/malformed env fails fast at
  startup, not at first use. Add new env vars here, not ad hoc `process.env` reads.
- **Versioning**: URI versioning (`app.enableVersioning`), controllers opt in
  with `@Controller({ version: "1" })` → `/v1/...`. `/health` and `/ready` stay
  unversioned (liveness/readiness probes).
- **Errors**: RFC 9457 `problem+json` via `ProblemDetailsFilter`
  (`src/common/problem-details.filter.ts`), applied per-controller with `@UseFilters`.
- **Persistence**: Prisma (`src/prisma/prisma.service.ts`), schema at
  `apps/api/prisma/schema.prisma`. Deliberately minimal — resist growing it
  beyond what the current story needs (see comments in the schema file).
- **Ingest pipeline** (`src/modules/import/`), wired in `import.module.ts`:
  - `AllowlistFetch` (`http/allowlist-fetch.ts`) — SSRF-safe fetcher locked to
    a single allowlisted host (the Viator API host, from `VIATOR_API_BASE_URL`).
    Reused for both the product client and the location resolver so
    `/locations/bulk` gets the same guard as the crawl.
  - `ViatorClient` (`clients/viator.client.ts`) — crawls
    `/products/modified-since`, paginates, rate-limits/backs off, and archives
    raw payloads via `RawArchiveStore`.
  - `R2RawArchiveStore` (`storage/raw-archive.store.ts`) — archives raw OTA
    payloads to Cloudflare R2 (S3-compatible, via `@aws-sdk/client-s3`).
  - `scope-filter.ts` (`decideIngestScope`) — runs on **raw** products, per
    page, before anything downstream. `/products/modified-since` returns
    Viator's entire global catalog with no server-side destination filter, so
    this drops everything that isn't (a) one of the curated cities
    (`curated-cities.ts`, exact destination-ref match, 6 cities), (b) `ACTIVE`,
    and (c) instant-confirmation. Applying it here (BRI-170/171) is what keeps
    the expensive downstream stages running against the curated cities' products
    only, not the whole catalog.
  - `normalizer.ts` — **pure function**, no DB/network/clock access. Maps a raw
    `ViatorProduct` to `TourDTO`. Ownership boundary: only sets
    provider-sourced fields + provenance (title, rating, `affiliate_url`, etc.)
    — never Atlas-owned fields (editor rating, curated tags, slug, curation
    status). Note detail payloads carry **no price**, so the normalizer leaves
    it null. Keep that boundary when extending it.
  - `LocationResolver` + `PrismaLocationCache` (`location-resolver.ts`,
    `location-cache.prisma.ts`) — resolves opaque Viator location refs to
    coordinates once, cached indefinitely in `ProviderLocation` (Viator's
    guidance: location data refreshes monthly, no short-lived invalidation).
  - `PriceResolver` (`price-resolver.ts`, ST-7c/BRI-165) — attaches the "from"
    price per product from `/availability/schedules/{code}`, since the detail
    payload the crawl ingests has no price field. Same attach-after-normalize
    shape as the location resolver.
  - `ExchangeRateResolver` + `ReferencePriceResolver` (`exchange-rate-resolver.ts`,
    `reference-price.ts`) — convert each product's supplier currency "from" price
    to a USD reference price (`Tour.priceReferenceMinor`, currency from
    `PRICE_REFERENCE_CURRENCY`), run per page right after `PriceResolver`. Rates
    come from Viator's `/exchange-rates` (a **POST**, GET returns 405), cached in
    `ProviderExchangeRate` until Viator's own `expiry`. Never fabricated: a
    currency with no resolvable rate leaves the reference price null.
  - `ExperienceAutoPromoter` (`experience-auto-promoter.ts`) — promotes draft
    Experiences that are complete (title, description, a linked Tour with an
    image, an affiliate link and a positive USD reference price) to published;
    `segment-worker.cli.ts` calls it during each run. It checks completeness
    only, not quality, so editorial review (M7) is still separate.
  - `TourValidator` (`validator.ts`) then `TourUpsertService` (`upsert.ts`) —
    validate/quarantine, then idempotent per-page upsert; a once-per-run
    `finalizeGuardedSoftDelete` handles soft-deletes behind a mass-deletion
    guard, and `ExperienceLinker` links the committed catalogue to curated
    cities.
  - The stages are threaded per page by `import.pipeline.ts` (`runSegment`),
    orchestrated by `ImportRunService`. A run is split across short-lived OS
    processes (`segment-worker.cli.ts`, spawned by `ImportRunService`) so
    `undici`'s response-decoding memory is fully released between segments
    (BRI-176) — this keeps the nightly crawl's memory profile bounded
    regardless of host (originally sized against Render's 512MiB free-tier
    limit; migrated to Railway — see BRI-182's `IMPORT_MEMORY_LIMIT_MB` /
    `IMPORT_CRAWL_RESTART_MEMORY_PCT` for the current evidence-based
    thresholds). `ImportScheduler` (`scheduler.ts`, ST-10/BRI-107) registers the
    nightly cron (`IMPORT_CRON_SCHEDULE` / `IMPORT_CRON_ENABLED`), fired on
    Railway by the dedicated `@folio/api-cron` service (see "Deployment —
    Railway" above); runs can also be fired manually via `trigger-import.cli.ts`.
    BRI-173's external wake trigger + self-heartbeat (a Render free-tier
    workaround) was retired with the Railway migration — Railway services
    don't idle-spindown the way Render's free tier did, so nothing needed to
    wake them.
  - Everything here is DI-token-based (`VIATOR_HTTP`, `RAW_ARCHIVE_STORE`,
    `LOCATION_CACHE`) so tests can substitute fakes.
- **Modules present today**: `health`, `database`, `redis`, `prisma`,
  `destinations` (read-only `/v1/destinations/:country/:city`), `search`
  (`GET /v1/search`, Postgres FTS over Experiences + Destinations — ST-13/16),
  `affiliate` (`POST /v1/affiliate-clicks`, the click-log write backing the web
  `/go` redirect — BRI-136), and `modules/import` (the ingest pipeline above,
  wired to the nightly cron scheduler), `modules/content`
  (`tour-copy-eligibility.ts` — BRI-200's pure rating/review-count gate for AI
  tour copy; not yet called by any pipeline, cron or route).
- **`modules/research`** (BRI-206 hub-page validation, CLI only, no Nest module):
  `pnpm --filter @folio/api research:hub <candidates|demand|serp|classify|spend>`.
  Layout: `core/` (rule gate, candidate + classification logic, Viator catalog),
  `pricing/` (price table, spend guard/ledger), `stages/` (one file per pipeline
  stage), `providers/` (search-provider client). `research.cli.ts` **stays at
  the module root**: it derives `RESEARCH_DATA_DIR` (`apps/api/research-data`,
  gitignored, holds the spend ledger) and the repo root from `__dirname`, so
  moving it would silently reset the monthly spend accounting to $0
  (`research.cli.spec.ts` pins the location). Same reason its `*.spec.ts`
  files that read `docs/research/bri-206/rule.md` count `../` from their own folder.
