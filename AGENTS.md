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

### Prod migrations (BRI-197)

Merging to `master` auto-deploys code to Railway, so migrations have to land
with it. Each Railway service (`@folio/api` and `@folio/api-cron`) runs
`pnpm --filter @folio/api migrate:deploy` as its **pre-deploy command**, declared
as `preDeploy` in `.railway/railway.ts` (the source of truth for both services;
it takes effect when someone runs `railway config apply`, see below). That runs
inside the new deployment, before it takes traffic; if it fails, the deploy
fails and the previous version keeps serving. Both services run the same
command, and Prisma's advisory lock serializes concurrent runs.

- **Needs `DIRECT_URL`.** The datasource declares
  `directUrl = env("DIRECT_URL")`, which the Prisma CLI uses instead of
  `DATABASE_URL`. It must be the **unpooled** Neon host (no `-pooler`): the
  migration advisory lock isn't safe through PgBouncer transaction mode. Set it
  in Doppler (`dev`, `prd`). Never point it at the pooled URL. CI sets it to the
  same ephemeral container URL as `DATABASE_URL`. It is declared `preserve()` in
  `railway.ts` for both services; see "Variables" below for how it reaches each.
- **Only additive migrations are safe.** During a rollout the old code briefly
  runs against the new schema. Destructive changes (drop or rename a column or
  table) need expand-then-contract across two deploys.
- **Transitional:** until the first real migration has been confirmed applied by
  the pre-deploy step, the manual `doppler run --config prd -- pnpm --filter
  @folio/api migrate:deploy` step in release/cleanup prompts stays mandatory.
  Remove this note once that's confirmed.
- **Pre-deploy timeout:** Railway's default is *no limit*, so a command stuck on
  the advisory lock would hold the deploy open. The live config key is
  `preDeployTimeoutSeconds`, declared in `railway.ts` at **300** on both
  services. The SDK's `DeployConfig` type (`railway` 3.11/3.12) lacks the field,
  but the IaC runtime spreads `deploy` into the service node, so the key passes
  through; `railway.ts` types it with a small local intersection type. Don't set
  it in the dashboard or through the MCP: an apply overwrites it with the file's
  value, and the dashboard hides the field on cron services anyway. If a plan
  ever shows `preDeployTimeoutSeconds` changing, stop and investigate before
  applying.
- **Applying `railway.ts`:** it's applied by hand (no CI or hook runs it on
  merge). After merging a change to it, preview with `railway config plan`,
  review every line (an apply pushes the whole file, not just your edit), then
  `railway config apply`. Don't set the pre-deploy command through the
  dashboard/MCP instead: it would drift from the file and a later apply could
  remove it.
- **`railway.ts` must match the live environment one-to-one.** An apply
  *creates* anything the file declares and *deletes* any variable it doesn't.
  Prod has Redis (with its volume), `@folio/api` and `@folio/api-cron`, and no
  Postgres service: the database is Neon. So don't re-declare a Postgres
  service or any resource that isn't live, and run `railway config plan` and
  read it before every apply.
- **Variables.** In `railway.ts` every variable is `preserve()`d. An apply keeps
  the live value of a listed variable and, per the file's own notes, drops one
  that isn't listed, so a new variable must be added to the service's `env`
  block. Doppler's Railway integration did **not** reach `@folio/api-cron`:
  its `DIRECT_URL` was added by hand in the dashboard, so don't assume a Doppler
  change reaches both services; check each.
- **Two sources for `@folio/api`'s variables.** They come from the Doppler sync
  *and* from `railway.ts`, and an apply deletes anything the file doesn't
  declare. So any new secret added to Doppler `prd` must **also** be added to
  `railway.ts` with `preserve()` (on each service that needs it), or the next
  apply removes it.

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

## Agent skills

Installed from `mattpocock/skills`, pinned by `skills-lock.json`. Update deliberately (`npx skills update`, in its own PR), never as a side effect of other work.

- **`code-review`.** Run it on every non-trivial diff before the PR is merged. CodeRabbit is on the free tier and rate-limited, so its passing check can mean no review happened. Review against this file, the relevant `apps/*/AGENTS.md`, and the task's plan or spec (`docs/superpowers/plans/`, `docs/specs/`).
- **`prototype`.** Answers a design or behaviour question with throwaway code. Use it only when the session's prompt asks for a prototype.
- **`diagnosing-bugs`.** For hard bugs, starting from a failing repro. Import-pipeline repros run against Doppler `dev`, never `prd`.

**Rules that override any skill's instructions:**

- **No tracker writes.** Linear is owned by the planning chat, which carries the cross-session context. Skills may read Linear; they never create, edit, comment on, label or close issues. PR bodies use the `Fixes BRI-xxx` / `Contributes to BRI-xxx` line the session's prompt specifies.
- **Inline, one task per session.** Implementation never fans out to subagents. Read-only subagents that change nothing (such as `code-review`'s two review axes) are fine.
- **Stay in scope.** Inside an implementation task, don't start a prototype or a bug-diagnosis loop unprompted. Report the need instead.
- **Deliberately not adopted; don't install:** `setup-matt-pocock-skills`, `grill-with-docs`, `to-spec`, `to-tickets`, `implement`, `implement-spec`, `triage`, `wayfinder`, `handoff`. Planning runs through `/scope` → `/architect` → `/develop` and the planning chat. Handoffs are the dated handoff docs.

**Prototypes:**

- They live outside this repo, in `~/dev/canvas-Gallery` (canvas work: `atlas-layouts/`), on their own branch. They are never merged into this repo, and app code never imports them.
- Data comes from Doppler `dev` only, read-only. The pattern is `atlas-layouts/scripts/export-bucket.mjs`, which refuses any other config.
- A prototype round ends in two places: its README in canvas-Gallery records the rules and results, and the epic map records what was learned (items move from Open to Decided or Parked).
- The `prototype` skill's own placement steps don't apply here: no prototype code in this repo, no `?variant=` switchers in app routes, no throwaway branch in this repo, no pointer comment on the issue. The rules above win; the skill's question → throwaway → answer loop still applies.

**Epic maps (for epics whose end state is still unclear):**

- **One living map per epic,** in `docs/superpowers/plans/`, with these sections: Decided, Open, Parked, and Known doc inconsistencies.
- **Every Open item has:**
  - a stable ID (`O<n>`, never renumbered);
  - a type: `grilling` (Roy's call), `prototype`, `research` (answered by reading or measuring) or `task` (a human must do it);
  - a status: proposed, evidence pending or ready;
  - what it blocks.
- **Who edits it.** The planning chat owns the map's structure and decisions. A Claude Code session edits only the items its task resolved, and lists those edits in its report.
- **Current maps:** EP-21 bucket discovery (inherits shelved EP-20's map) → `docs/superpowers/plans/2026-10-05-canvas-ideation-decisions.md`.

**Design tools:** Paper (MCP server `paper-desktop`) is paused as of 8 Oct 2026. Don't use it unless a prompt asks. Its outputs are captured in spec 0004 and `docs/superpowers/plans/2026-10-03-paper-04-resume-status.md`: the token names, the caption heights 68/57/14 and the clearance result.

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
- [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md): Linear team/project, read-only rule for agents, where specs and plans live
