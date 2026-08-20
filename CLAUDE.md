# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Folio Voyage (product name **Atlas**) is a travel-affiliate platform: destination
guides with curated, bookable experiences monetized via OTA affiliate links
(Viator today). It is a pnpm + Turborepo monorepo. It began as a standalone
Next.js app in `./frontend`; that directory has since been removed and the app
now lives in `apps/web`, with a new `apps/api` backend built alongside it.

```
apps/
  web/     Next.js 15 (App Router) frontend — "the existing app", moved from the old ./frontend
  api/     NestJS API (modular monolith) — new backend, built module by module
packages/
  shared/  @folio/shared — domain types shared by web + api
```

**Do not deploy without explicit go-ahead from Roy.** Build/verify locally only.

## Two content systems in transition — don't conflate them

The site currently runs on **two parallel data sources for destinations**, and
most of the active backend work is migrating from the first to the second:

1. **Static, hand-authored content** (`apps/web/src/data/destinations.ts` +
   `viator-links.json` / `viator-destinations.json`): no database, no ingest
   pipeline. A destination is added by hand per `docs/10-adding-a-new-destination-playbook.md`.
   Viator links are attached via a one-time fuzzy-match script
   (`apps/web/scripts/fetch-viator-links.mjs`), not live sync. This is the path
   that serves the canonical `/destinations/:slug` pages today.
2. **Database-backed ingest pipeline** (`apps/api/src/modules/import/*` →
   Postgres via Prisma → `apps/api/src/destinations`): `ViatorClient` crawls and
   archives raw OTA payloads from `/products/modified-since`, a per-page scope
   filter keeps only the curated cities, `normalizer.ts` translates survivors
   into Atlas's own `TourDTO` (pure function, provider-owned fields only),
   `LocationResolver` resolves opaque Viator location refs to lat/lng via
   `/locations/bulk` (cached in `ProviderLocation`), a price resolver attaches
   the "from" price from `/availability/schedules`, then validate/quarantine and
   an idempotent upsert land rows the `ExperienceLinker` links to curated cities.
   It runs nightly on a cron and covers models `City`, `Experience`, `Tour`,
   `QuarantinedTour`, `ImportRun`, `ProviderLocation`, `AffiliateClick`. This is
   the intended long-term source of truth; today it backs the DB-read
   `/destinations/:country/:city` alias for imported cities, while static content
   still serves cities not yet imported. See the "Ingest pipeline" section below
   for the full stage-by-stage architecture.

When working on destination/content features, check which system a given page
or story actually touches before assuming the other one applies.

## Commands

Run from the repo root unless noted. Node 22 (`.nvmrc`), pnpm 11 via corepack.

```bash
pnpm install                       # install all workspaces
pnpm dev                           # web (:3000) + api (:3001) via Turbo, watch mode
pnpm build                         # build every workspace
pnpm lint                          # lint every workspace
pnpm typecheck                     # typecheck every workspace

pnpm --filter @folio/web dev       # run a single app
pnpm --filter @folio/api dev

# API tests (jest, specs live next to source as *.spec.ts)
pnpm --filter @folio/api test
pnpm --filter @folio/api exec jest src/modules/import/normalizer.spec.ts   # single file
pnpm --filter @folio/api exec jest -t "test name"                          # single test

# Local backing services (Postgres w/ PostGIS+pg_trgm, Redis) for apps/api
docker compose -f infra/docker-compose.yml up -d

# Prisma (run from apps/api)
pnpm --filter @folio/api exec prisma migrate dev     # create/apply a migration locally
pnpm --filter @folio/api exec prisma generate        # regenerate client (also runs on postinstall)
pnpm --filter @folio/api prisma:seed                 # seed via prisma/seed.ts
```

`apps/web` has no test script yet. `pnpm build`/`lint`/`typecheck` are wired
through Turbo with caching and `dependsOn: ["^build"]`; CI runs them with
`--affected` on PRs (full run on `master` pushes) — see `.github/workflows/ci.yml`.

## Skill persistence across worktrees

Claude Code planning skills (`writing-plans`, `subagent-driven-development`,
from `obra/superpowers` via `npx skills add`) are **tracked in git**, not
per-developer local state. `npx skills add` writes real files to
`.agents/skills/<name>/` and symlinks them from `.claude/skills/<name>` — both
paths are committed, and `.gitignore` carves an explicit exception out of the
blanket `.claude/` ignore for `.claude/skills/` (switched to `.claude/*` so a
negation can reach inside it; `.claude/worktrees/` and local settings stay
ignored). This was **not** the case before 2026-08-20: skills installed in a
worktree lived only in that worktree's untracked `.claude/`/`.agents/` dirs
and vanished when the worktree was deleted, so every prior "plan" (BRI-170,
BRI-175, BRI-176) was Claude following the brief's instructions directly, not
this skill. If a new planning/execution skill gets installed, commit
`.agents/skills/<name>/` and `.claude/skills/<name>` the same way, or a fresh
`git worktree add` won't have it.

## Architecture

### `apps/api` — NestJS modular monolith

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
    the expensive downstream stages running against ~90 curated products, not
    the whole catalog.
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
  - `TourValidator` (`validator.ts`) then `TourUpsertService` (`upsert.ts`) —
    validate/quarantine, then idempotent per-page upsert; a once-per-run
    `finalizeGuardedSoftDelete` handles soft-deletes behind a mass-deletion
    guard, and `ExperienceLinker` links the committed catalogue to curated
    cities.
  - The stages are threaded per page by `import.pipeline.ts` (`runSegment`),
    orchestrated by `ImportRunService`. A run is split across short-lived OS
    processes (`segment-worker.cli.ts`, spawned by `ImportRunService`) so
    `undici`'s response-decoding memory is fully released between segments
    (BRI-176) — this keeps the nightly crawl inside Render's 512MiB free-tier
    limit. `ImportScheduler` (`scheduler.ts`, ST-10/BRI-107) registers the
    nightly cron (`IMPORT_CRON_SCHEDULE` / `IMPORT_CRON_ENABLED`); BRI-173 adds
    an external wake trigger + self-heartbeat for the free tier, and runs can
    also be fired manually via `POST /v1/import/trigger` or `trigger-import.cli.ts`.
  - Everything here is DI-token-based (`VIATOR_HTTP`, `RAW_ARCHIVE_STORE`,
    `LOCATION_CACHE`) so tests can substitute fakes.
- **Modules present today**: `health`, `database`, `redis`, `prisma`,
  `destinations` (read-only `/v1/destinations/:country/:city`), `search`
  (`GET /v1/search`, Postgres FTS over Experiences + Destinations — ST-13/16),
  `affiliate` (`POST /v1/affiliate-clicks`, the click-log write backing the web
  `/go` redirect — BRI-136), and `modules/import` (the ingest pipeline above,
  wired to the nightly cron scheduler).

### `apps/web` — Next.js 15 App Router

- Server components fetch destination data from the API via
  `src/lib/api.ts` (`fetchDestination`) — `API_BASE_URL` env var, no client-side
  fetching, no data hardcoded in components. A 404 from the API becomes `null`
  → Next.js not-found; any other failure throws.
- `src/app/destinations/[slug]/page.tsx` (and the rest of `src/data/`) read the
  static `destinations.ts` content system and are the **canonical** destination
  surface. `src/app/destinations/[slug]/[city]/page.tsx` is the DB-backed
  ST-11 ingest URL, kept only as a permanent alias that **308-redirects** to the
  canonical short URL (BRI-166) — it renders nothing itself. `src/lib/api.ts`
  (`fetchDestination`) and `DbExperienceCard` are the retained DB read layer a
  follow-up (BRI-168) will use to surface ingested price/image/`affiliateUrl` on
  the canonical editorial cards. See "Two content systems" above.
- UI building blocks live in `src/components/`; a themed subset (marketing
  site look) lives under `src/components/covilla/`.
- Tailwind v4 (`@tailwindcss/postcss`), ESLint via `next/core-web-vitals` + `next/typescript`.

### Analytics — PostHog (client-side, `apps/web`)

Product analytics runs **entirely client-side** in the web app (there is no
server-side analytics service yet). Initialised in
`apps/web/instrumentation-client.ts` (the Next.js 15.3+ pattern — do **not** add a
`PostHogProvider`), with ingestion reverse-proxied through `/ingest`
(`next.config.ts` rewrites) so ad-blockers don't drop events. Capture is
anonymous: `person_profiles: "identified_only"` and we never call `identify`; IP
anonymisation, ~50% session-replay sampling, and full input/text replay masking
are set project-side in PostHog (US region).

- **Events:** autocapture (`$pageview`, web vitals) + ~12 custom events. The
  revenue event is `experience_booking_clicked` — fire **all** affiliate-CTA
  captures through the shared `trackAffiliateClick()` helper in
  `src/lib/analytics.ts` (it carries `experience_id` + destination context), never
  an inline `posthog.capture`. Dormant affiliate cards (`DbExperienceCard`,
  `ExperienceCard`) should adopt the same helper when they regain booking links.
- **Env:** `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` (documented in
  `apps/web/.env.example`); set in Vercel. No host var — the proxy path and UI
  host are hardcoded. Nothing sends until the token is set + a fresh build ships.
- **Scope boundary:** this **partially** satisfies FR-ANALYTICS-1 (page views +
  affiliate clicks today; search/filter/pin events land as those features do). It
  is client-side behavioural capture only and is **complementary to** — not a
  replacement for — the server-side click ledger (FR-AFF-1), which has since
  shipped: `apps/web`'s `/go/:slug/:id` route (`src/app/go/[slug]/[id]/route.ts`)
  logs each click by POSTing to the API's `POST /v1/affiliate-clicks`
  (`AffiliateClick` model) before 302-ing to the verbatim `productUrl` (BRI-136).
  Don't treat PostHog as covering the ledger, or vice versa.

### `packages/shared`

`@folio/shared` — cross-cutting domain types consumed by both `web` and `api`
via `workspace:*`. Type-only package (`main`/`types` point at `src/index.ts`
directly, no build step); add shared DTOs/types here rather than duplicating
them in both apps.

## Docs hierarchy

`docs/` holds three living documents derived from
`Travel-Affiliate-Platform-Master-Product-Specification-v1.0.md` (the archival
umbrella spec). Traceability is one-directional and enforced by convention:

```
Product Bible (01, WHY)  →  System Architecture Spec (02, HOW, FR-*/NFR-* IDs)  →  Engineering Spec (03, WHAT/order, user stories)  →  GitHub Issue  →  PR
```

- Changing a requirement → edit doc 02 first, then propagate to doc 03 stories.
- Changing strategy/scope → edit doc 01 first, then propagate down.
- Work is tracked as milestones/epics/stories in doc 03, mirrored 1:1 into
  Linear (`BRI-*` issue keys map to story numbers like `ST-6`).
- `docs/07`, `docs/08`, `docs/10` cover the current hand-authored content
  workflow (Viator link-matching, brand voice, destination playbook), now
  written against `apps/web`. `docs/06-viator-api-integration-guide.md` and
  `docs/13-viator-api-audit.md` cover the DB ingest pipeline and its open
  API-policy questions; `docs/04` and `docs/05` are historical, completed briefs
  (the original scaffold and pre-launch audit) kept for provenance.

## CI

`.github/workflows/ci.yml` runs two jobs on every PR into `master`:
`lint-typecheck-test` (Turbo, `--affected` on PRs) and `migrate` (spins up an
ephemeral `postgis/postgis:16-3.4` container, enables `postgis`/`pg_trgm`, then
`prisma migrate deploy` against it — validates real migrations exist and apply
cleanly). No secrets are hard-coded there; CI Postgres credentials are
throwaway values for a container destroyed at job end.
