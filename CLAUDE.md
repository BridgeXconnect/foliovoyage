# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Folio Voyage (product name **Atlas**) is a travel-affiliate platform: destination
guides with curated, bookable experiences monetized via OTA affiliate links
(Viator today). It is a pnpm + Turborepo monorepo being migrated from a
standalone Next.js app (`./frontend`, legacy, still present but no longer the
source of truth) into `apps/web` + `apps/api`.

```
apps/
  web/     Next.js 15 (App Router) frontend — "the existing app", moved from ./frontend
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
   pipeline. A destination is added by hand per `docs/10-adding-a-new-destination-playbook.md`
   (note: that doc still says to run from `./frontend` — it predates the
   monorepo move and its commands need translating to `apps/web`). Viator links
   are attached via a one-time fuzzy-match script, not live sync.
2. **Database-backed ingest pipeline** (`apps/api/src/modules/import/*` →
   Postgres via Prisma → `apps/api/src/destinations`): `ViatorClient` fetches
   and archives raw OTA payloads, `normalizer.ts` translates them into Atlas's
   own `TourDTO` (pure function, provider-owned fields only), `LocationResolver`
   resolves opaque Viator location refs to lat/lng via `/locations/bulk` and
   caches them in `ProviderLocation`. This is the future source of truth but
   only a first vertical slice (`City` + `Experience` models) exists so far.

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
  - `ViatorClient` (`clients/viator.client.ts`) — paginates, rate-limits/backs
    off, and archives raw payloads via `RawArchiveStore`.
  - `R2RawArchiveStore` (`storage/raw-archive.store.ts`) — archives raw OTA
    payloads to Cloudflare R2 (S3-compatible, via `@aws-sdk/client-s3`).
  - `normalizer.ts` — **pure function**, no DB/network/clock access. Maps a raw
    `ViatorProduct` to `TourDTO`. Ownership boundary: only sets
    provider-sourced fields + provenance (title, price, rating, `affiliate_url`,
    etc.) — never Atlas-owned fields (editor rating, curated tags, slug,
    curation status). Keep that boundary when extending it.
  - `LocationResolver` + `PrismaLocationCache` (`location-resolver.ts`,
    `location-cache.prisma.ts`) — resolves opaque Viator location refs to
    coordinates once, cached indefinitely in `ProviderLocation` (Viator's
    guidance: location data refreshes monthly, no short-lived invalidation).
  - Everything here is DI-token-based (`VIATOR_HTTP`, `RAW_ARCHIVE_STORE`,
    `LOCATION_CACHE`) so tests can substitute fakes.
- **Modules present today**: `health`, `database`, `redis`, `prisma`,
  `destinations` (read-only `/v1/destinations/:country/:city`), `modules/import`
  (ingest, not yet wired to a scheduled job).

### `apps/web` — Next.js 15 App Router

- Server components fetch destination data from the API via
  `src/lib/api.ts` (`fetchDestination`) — `API_BASE_URL` env var, no client-side
  fetching, no data hardcoded in components. A 404 from the API becomes `null`
  → Next.js not-found; any other failure throws.
- `src/app/destinations/[slug]/[city]/page.tsx` is the API-backed route (the
  new vertical slice); `src/app/destinations/[slug]/page.tsx` and the rest of
  `src/data/` still read the static `destinations.ts` content system — see
  "Two content systems" above.
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
  is client-side behavioural capture only and does **not** replace the
  server-side `/go/:tourId` log-then-302 ledger (FR-AFF-1 / **ST-24**, still open,
  P1) — the two are complementary. Don't close EP-8 on the basis of PostHog.

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
  workflow (Viator link-matching, brand voice, destination playbook); treat the
  playbook's `./frontend`-relative commands as needing translation to
  `apps/web` per the monorepo move.

## CI

`.github/workflows/ci.yml` runs two jobs on every PR into `master`:
`lint-typecheck-test` (Turbo, `--affected` on PRs) and `migrate` (spins up an
ephemeral `postgis/postgis:16-3.4` container, enables `postgis`/`pg_trgm`, then
`prisma migrate deploy` against it — validates real migrations exist and apply
cleanly). No secrets are hard-coded there; CI Postgres credentials are
throwaway values for a container destroyed at job end.
