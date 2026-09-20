# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, and others) when working with code in this repository.

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
   still serves cities not yet imported. See [apps/api/AGENTS.md](apps/api/AGENTS.md)
   for the full stage-by-stage architecture.

When working on destination/content features, check which system a given page
or story actually touches before assuming the other one applies.

## Local secrets — Doppler, not a copied `.env` file

Real env values (API keys, R2 credentials, shared secrets) live in Doppler
project `foliovoyage`, config `dev` — **not** in a canonical `~/secrets/...env`
file copied into each worktree's `.env`. Run local dev through
`doppler run --`, e.g. `doppler run -- pnpm dev`, and Doppler injects the
values into the process env; no `.env` file with real secrets needs to exist
on disk at all. `apps/api/.env.example` and `apps/web/.env.example` stay as
the documented list of which variables exist and what they do — Doppler is
where the real values live.

**Why:** a copied secrets file sitting in every worktree's `.env` is one more
place a real credential can end up committed, pasted into a shared terminal,
or picked up by a tool that reads `.env` blindly (agent transcripts included).
Doppler keeps the plaintext in one place (Doppler's vault) and only ever
materializes it transiently into a process's environment. Don't silently
revert to the copy-a-file pattern — if `doppler run` is inconvenient in some
context, fix that, don't route around it.

A single `dev` config is shared by both apps (see the variable groups below)
rather than split per-app, because a few variables (`VIATOR_API_KEY`,
`INTERNAL_CLICK_SECRET`) must hold the **same** value in both `apps/api` and
`apps/web`, and the root `pnpm dev` runs both under one Turbo process tree —
splitting configs would mean keeping shared values in sync by hand across two
places, and running two separate `doppler run` invocations to start one `pnpm
dev`.

## Deployment

- `apps/api` deploys to Railway (project `striking-smile`), two services
  (`@folio/api`, `@folio/api-cron`) in one environment. Full service config,
  cron setup, and env sync: [apps/api/AGENTS.md](apps/api/AGENTS.md).
- `apps/web`'s `API_BASE_URL` points at `@folio/api`'s Railway domain — see
  that env var in Vercel's project settings, not this repo, for the current value.

## Commands

Run from the repo root unless noted. Node 22 (`.nvmrc`), pnpm 11 via corepack.

```bash
pnpm install                       # install all workspaces
doppler run -- pnpm dev            # web (:3000) + api (:3001) via Turbo, watch mode
pnpm build                         # build every workspace
pnpm lint                          # lint every workspace
pnpm typecheck                     # typecheck every workspace
pnpm turbo run test                # run every workspace's jest tests (CI runs this too)

doppler run -- pnpm --filter @folio/web dev   # run a single app, see apps/web/AGENTS.md
doppler run -- pnpm --filter @folio/api dev   # see apps/api/AGENTS.md
```

`pnpm build`/`lint`/`typecheck` are wired
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

## Context files

- [apps/api/AGENTS.md](apps/api/AGENTS.md): NestJS modular monolith — config/versioning/errors conventions, the ingest pipeline stage by stage, Railway deployment, API commands
- [apps/web/AGENTS.md](apps/web/AGENTS.md): Next.js 15 App Router — data fetching, the two-content-system routing, PostHog analytics, web commands
- [packages/shared/AGENTS.md](packages/shared/AGENTS.md): `@folio/shared` — cross-cutting domain types
