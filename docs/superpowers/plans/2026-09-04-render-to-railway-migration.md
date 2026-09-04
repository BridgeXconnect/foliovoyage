# Render → Railway Migration for `apps/api` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `apps/api` (NestJS modular monolith: HTTP server + nightly Viator ingest pipeline) off Render onto Railway, replacing every Render-specific coupling (free-tier 512MiB ceiling, 15-minute inbound-only idle spindown, `RENDER_EXTERNAL_URL`, the BRI-173 external-wake workaround) with Railway-native equivalents, without regressing BRI-182's memory-pressure segment-restart safety net or breaking `apps/web`'s API calls.

**Architecture:** One Railway service (`@folio/api`) runs the HTTP server via config-as-code (`.railway/railway.ts`, monorepo `rootDirectory: "apps/api"`), health-gated on the real dependency check at `/ready`. A second, separate Railway service (`@folio/api-cron`) runs the same repo's compiled import CLI on Railway's native cron schedule — cron is modeled as its own service, not bolted onto the always-on web service, because Railway cron jobs run *the service's own start command* on a schedule, and the ingest pipeline's one-shot CLI entry point (`trigger-import.cli.ts`) is a different process shape than the HTTP server. Both services share one set of environment variables synced from Doppler's native Railway integration at the environment level, so neither service needs its own manually-entered copy. BRI-182's memory-restart trigger is ported from its unmerged branch into this branch with Railway-native default values (recalculated from real evidence, not copied from Render's 512MB assumption). `apps/web`'s `API_BASE_URL` is repointed once Task 1's live domain-stability result is known.

**Tech Stack:** NestJS 11 / Prisma / PostgreSQL+PostGIS+pg_trgm / Redis, Railway Infrastructure as Code (`.railway/railway.ts`, TypeScript, package `railway`), Railway CLI (`railway config plan` / `railway config apply`), Railway MCP tools (`mcp__347faa6d-be82-4118-b80d-0b6e8e052f9e__*`) for anything the current IaC DSL cannot express (cron schedule, sleep toggle, throwaway test service), Doppler (project `foliovoyage`, config `prd`) as the source of truth for secrets, pnpm + Turborepo monorepo.

**Spec:** No standalone spec doc exists for this migration — it was scoped directly in conversation with Roy (11 explicit requirements) plus a Phase 1 audit of every real Render coupling in this repo and live `docs.railway.com` research via the Railway MCP's `search-docs`/`fetch-docs` tools. Every claim about Railway's current behavior below was verified against live docs during this planning session (dated 2026-09-04), not recalled from training data — treat `docs.railway.com` as the spec for Railway-side behavior and this repo's own source (cited by exact path/line below) as the spec for what's being migrated.

## Global Constraints

- **Do not deploy without explicit go-ahead from Roy** (standing CLAUDE.md rule). Task 1's throwaway test service is the one exception explicitly pre-approved by Roy for this plan; every other live change (the real `.railway/railway.ts` apply, the cron service, the `apps/web` env var change, decommissioning Render) happens only after Roy has reviewed this plan and given the go-ahead for that specific task.
- **Do not touch Linear.** Do not touch Render (no Render MCP tools are even enabled in this environment — there is no read or write path to Render from here).
- **BRI-182's memory-restart trigger (`IMPORT_MEMORY_LIMIT_MB` / `IMPORT_CRAWL_RESTART_MEMORY_PCT`) does not exist on `master` or this branch.** It exists only on the unmerged branch `stewie/bri-182-memory-restart-f192fd` (commit `391d3280edadab23e7e30f432c15985e9cd16955`). Task 5 ports it into this branch from scratch with new default values — it is not a "recalculate an existing default" task.
- **Doppler's `prd` config (project `foliovoyage`) is currently empty** — verified via `doppler secrets --project foliovoyage --config prd --only-names`, which returned only Doppler's own auto-injected `DOPPLER_CONFIG`/`DOPPLER_ENVIRONMENT`/`DOPPLER_PROJECT` meta vars, no real secrets. Task 3 requires Roy to populate real production values into `prd` — this plan does not do that (real secret values must never pass through an agent's hands).
- **What backs production `DATABASE_URL`/`REDIS_URL` today is unconfirmed.** Render MCP tools are disabled in this environment, this was outside Phase 1's audit scope, and CLAUDE.md is silent on it. Task 3 must not assume `prd` will already hold correct production connection strings — Roy must confirm/supply the real ones.
  - **Update 2026-09-04:** this risk materialized — the first real `railway config apply` deployed with `prd`'s existing `DATABASE_URL`/`REDIS_URL` still holding local-dev-style `localhost` values, so `/ready` failed with `PrismaClientInitializationError: Can't reach database server at localhost:5433` plus a parallel Redis error. Roy chose (via explicit prompt) to provision new Railway-managed Postgres+Redis rather than point at an existing external instance — see the new "Postgres + Redis provisioning" note after Task 3 below for what was built and two IaC bugs hit along the way.
- **`striking-smile`** (id `10a94c58-638f-4597-836f-f00d663185fa`, environment `production` id `1a124cd9-4d95-4c33-af7d-2a261255fb3c`) is the migration target — Roy deleted the earlier `giving-fascination` project (id `bc569df8-fc6f-4460-ad42-b5ffaf20cf1e`, still visible via `list-projects` as of 2026-09-04, likely deletion-propagation lag — not to be used for anything further) and created `striking-smile` fresh with GitHub connected at the project level. It holds two service shells, `@folio/api` (id `9b1580c4-4b9b-4ae4-8b33-bb38feafa9f5`) and `@folio/web` (id `1fa39661-0804-447f-9e83-97c81c68525d`), both **unconfigured** at the per-service level — `get-service-config` returned "Service has no configuration in this environment" for both on 2026-09-04 (no source, build/start commands, or deployments attached to either service yet, even though the project has repo access). **This plan configures `@folio/api` (Tasks 1, 2, 4, 9) entirely via the Railway MCP connector, per Roy's explicit instruction** ("use the railway connector to access the account and do any setting up you need to"), rather than waiting on Roy's own `railway login`/`railway config apply` terminal session — the `.railway/railway.ts` IaC file (Task 2) is still authored for future declarative management (brief item 2), but initial setup happens directly through the MCP tools now. `@folio/web` is **not** touched by this plan — `apps/web` is hosted on Vercel per this repo's existing setup, so `striking-smile`'s empty `@folio/web` shell is unexplained; flag it to Roy before Task 9 (cutover) in case it signals an intent (e.g. migrating `apps/web` to Railway too) that this plan doesn't cover.
- **Cron schedule and the sleep/serverless toggle are NOT expressible in the current `.railway/railway.ts` TypeScript DSL** (confirmed against the full `/infrastructure-as-code/reference` page on 2026-09-04 — no `cronSchedule` or `sleepApplication`-equivalent field exists in the `service()` config). Both are set via the Railway MCP `update-service` tool (or the dashboard) instead, outside the IaC file.
- **Railway Hobby plan resource ceiling is 48GB RAM / 48 vCPU / 6 replicas per service**, billed usage-based (RAM $10/GB/month, CPU $20/vCPU/month, egress $0.05/GB) — not a small fixed allocation like Render's 512MB. This is why Task 5 cannot just percentage-rescale BRI-182's old Render-tied default.
- **Railway's sleep ("Serverless") is opt-in and off by default** — a service is always-on unless the `sleepApplication` toggle is explicitly enabled (confirmed via `/deployments/serverless` and the `update-service` tool's own field description, "Enable/disable app sleeping"). When enabled, inactivity is detected from the absence of **outbound** packets (not inbound — the opposite of what mattered on Render), sampled such that a service sleeps 5–10 minutes after its last outbound traffic, and wakes on the next inbound request. Task 1 verifies this empirically rather than trusting the docs alone, per Roy's explicit instruction.
- **Railway cron jobs**: standard 5-field crontab syntax, evaluated in **UTC only**, **minimum 5-minute interval**, and if a previous run is still active when the next is due, Railway **skips** the new run rather than terminating the old one.
- No existing `railway.toml`/`railway.json` exists anywhere in this repo (confirmed via `find`) — there is nothing to migrate from; `.railway/railway.ts` is authored fresh.
- `apps/api` has zero real dependency on `packages/shared` (only two JSDoc-comment mentions, not imports; not in `package.json` `dependencies`) — safe to scope Railway's monorepo `rootDirectory` to `apps/api` without a Dockerfile-at-repo-root fallback.

---

### Task 1: Empirical verification — sleep default and domain stability

Everything downstream (BRI-173 removal in Task 6, `apps/web`'s `API_BASE_URL` shape in Task 7) branches on this task's real, observed results against the live Railway project — not on the docs alone, per Roy's explicit instruction. This task is the one exception to "don't deploy anything beyond the empirical-verification task" — every other task in this plan waits for Roy's review before any further live change.

**Files:**
- Create: `docs/14-railway-migration-task1-findings.md`

**Interfaces:**
- Produces: the confirmed boolean answers to "does a Railway service sleep by default with no `sleepApplication` toggle touched?" and "is the generated `*.up.railway.app` domain stable across a redeploy?" — Tasks 6 and 7 read these findings directly.

- [x] **Step 1: Create the throwaway test service**

Call the Railway MCP `create-service` tool:
```
projectId: "10a94c58-638f-4597-836f-f00d663185fa"
environmentId: "1a124cd9-4d95-4c33-af7d-2a261255fb3c"
image: "traefik/whoami"
name: "migration-empirical-test"
```
`traefik/whoami` is a zero-config HTTP echo server with no background network activity of its own (no telemetry, no outbound polling) — it will only ever emit outbound traffic in direct response to an inbound request, making it a clean passive probe for the sleep timer's real trigger condition. Record the returned `serviceId`.

- [x] **Step 2: Expose it and confirm it's live**

Call `generate-domain` with the `projectId`/`environmentId` above and the `serviceId` from Step 1 (no `domain` argument — this generates the Railway `*.up.railway.app` domain). Record the exact returned hostname as **Domain A**.

`curl -sS -o /dev/null -w "%{http_code}\n" https://<Domain A>/` — wait for it to return `200` (allow a minute or two for the first cold build/deploy to finish; poll every 15s). Do not proceed until it returns `200`.

- [x] **Step 3: Confirm the sleep toggle was never touched**

Call `get-service-config` with the same `projectId`/`environmentId`/`serviceId`. Confirm the returned config shows no `sleepApplication: true` — this service has had nothing set on it beyond `create-service` and `generate-domain`, so this confirms the empirical test below is measuring Railway's real *default*, not a state Task 1 itself introduced.

- [x] **Step 4: Let it go idle and observe**

Do not send it any traffic — inbound or outbound — for at least **15 minutes** (comfortably past the documented 5–10 minute sampling window, whether or not sleep turns out to be enabled by default).

After the wait, run `curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" https://<Domain A>/` and record the exact status code and response time. A cold-start delay (multi-second `time_total`, or an initial `502`) indicates the service *did* go to sleep between requests; a fast, immediate `200` (comparable to Step 2's timing) indicates it stayed warm — i.e., Railway's always-on-by-default claim held.

- [x] **Step 5: Confirm via deployment history, not just latency**

Call `mcp__347faa6d-be82-4118-b80d-0b6e8e052f9e__get-status` with the `projectId`/`environmentId` and inspect the `migration-empirical-test` service's replica/deployment status entry. A sleep event should be visible here (a container stop/restart not caused by a redeploy) if one occurred between Steps 2 and 4. Record what this shows.

- [x] **Step 6: Test domain stability across a redeploy**

Call `redeploy` with the `projectId`/`environmentId`/`serviceId` from Step 1. Wait for the new deployment to report healthy (poll `get-status` or `curl` the domain until `200` again).

Call `list-domains` with the same `projectId`/`environmentId`/`serviceId`. Record the returned hostname as **Domain B**. Compare Domain A and Domain B character-for-character.

- [x] **Step 7: Record findings**

Create `docs/14-railway-migration-task1-findings.md` with this exact structure, filled in with the real values observed in Steps 1–6 (every bracketed placeholder below must be replaced with a real, dated, observed value — none may be left as a placeholder in the committed file):

```markdown
# Railway Migration — Task 1 Empirical Findings

Recorded [ISO date], against Railway project `10a94c58-638f-4597-836f-f00d663185fa`
(`striking-smile`), environment `production`
(`1a124cd9-4d95-4c33-af7d-2a261255fb3c`), using a throwaway `traefik/whoami`
service (`migration-empirical-test`, service id `[id]`).

## Question 1: Does a Railway service sleep by default (no `sleepApplication` toggle touched)?

- Domain A (Step 2): `[hostname]`
- Pre-idle response (Step 2): `[status code] [time]`
- `get-service-config` sleep field before the idle wait (Step 3): `[verbatim field value/absence]`
- Idle duration observed (Step 4): `[N] minutes with zero inbound/outbound traffic`
- Post-idle response (Step 4): `[status code] [time]`
- `get-status` deployment history (Step 5): `[what it showed — any stop/restart event or none]`
- **Conclusion: [Railway services are / are not] always-on by default with the sleep toggle untouched.**

## Question 2: Is the generated `*.up.railway.app` domain stable across a redeploy?

- Domain A (Step 2): `[hostname]`
- Domain B, after `redeploy` (Step 6): `[hostname]`
- **Conclusion: the generated domain [is / is not] stable across a redeploy.**

## Downstream impact

- Task 6 (BRI-173 removal): [state which branch of Task 6 this triggers]
- Task 7 (`apps/web` `API_BASE_URL`): [state which branch of Task 7 this triggers]
```

- [x] **Step 8: Commit the findings**

```bash
git add docs/14-railway-migration-task1-findings.md
git commit -m "docs(infra): record Task 1 empirical findings for Railway migration (BRI-182 follow-up)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [x] **Step 9: Flag manual cleanup to Roy**

There is no `delete-service` tool in the Railway MCP server available in this session. Tell Roy the `migration-empirical-test` service (id from Step 1) needs to be deleted manually from the Railway dashboard — it is not needed again after this task and should not be left running.

---

### Task 2: Author `.railway/railway.ts` for `@folio/api` (config-as-code, monorepo root, healthcheck)

Covers brief items 2 (config-as-code via the current IaC format), 3 (monorepo root directory `/apps/api`), and 7 (healthcheck on `/ready`, real dependency check — see `apps/api/src/health/readiness.controller.ts:1-31`, which fails 503 unless both `DatabaseHealthIndicator` and `RedisHealthIndicator` report healthy).

This task authors and previews the file only (`railway config plan`) — it does **not** run `railway config apply` against the real `@folio/api` service. The apply happens in Task 9 (Cutover), after Task 3 (Doppler) has populated real values for every `preserve()`d variable — applying before that would apply against variables with nothing to preserve.

**Files:**
- Create: `.railway/railway.ts`
- Modify: `package.json` (root) — add `railway` as a devDependency

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the `.railway/railway.ts` file Task 9's `railway config apply` step runs against.

- [x] **Step 1: Add the `railway` package**

```bash
pnpm add -Dw railway
```

- [x] **Step 2: Author `.railway/railway.ts`**

Create `.railway/railway.ts`:

```ts
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
```

Notes on this file, to resolve at Task 9 apply time, not now:
- `IMPORT_TRIGGER_SECRET` / `RENDER_EXTERNAL_URL` are deliberately **not** listed — Task 6 decides whether BRI-173 (and these two vars) survive the migration at all, based on Task 1's findings. If Task 6 keeps BRI-173, add `IMPORT_TRIGGER_SECRET: preserve()` here before Task 9's apply.
- `PORT` is deliberately **not** declared — Railway auto-injects `PORT` for services with a public network binding, the same way Render did, and `apps/api`'s schema already reads it via `process.env.PORT` with a `3001` fallback (`apps/api/src/config/env.validation.ts:17`).
- `NODE_ENV` is deliberately **not** declared — Railway sets it automatically for production deployments, and the schema already defaults it if absent (`apps/api/src/config/env.validation.ts:12-14`).

- [x] **Step 3: Link the CLI to the real project (Roy-executed — needs interactive login)**

This step needs Roy's own terminal, not this session — `railway login` opens an interactive browser auth flow this session cannot complete. Ask Roy to run, from the repo root:
```bash
railway login
railway link
```
and select the `striking-smile` project (id `10a94c58-638f-4597-836f-f00d663185fa`) / `production` environment (id `1a124cd9-4d95-4c33-af7d-2a261255fb3c`) when prompted — this is the project Roy set up as the actual migration target, distinct from `giving-fascination` (Task 1's sandbox).

**Done 2026-09-04.** Roy ran this twice: first from the main checkout on `master` (`/Users/roymkhabela/Folio_Voyage`), which does **not** have this branch's `.railway/railway.ts` or `railway` package — `railway config plan` there found no IaC state and offered to "initialize" one via "Import an existing Railway project," which generated a *different*, throwaway `.railway/railway.ts` reflecting `striking-smile`'s live (mostly empty) state. That generated file was discarded (`rm -rf .railway` in the main checkout) and not committed anywhere. Roy then re-ran `railway login`/`railway link` from **this worktree** (`.../worktrees/skill-persistence-worktrees-bcc344`, on this branch), where the committed `.railway/railway.ts` and `railway` devDependency already exist — link succeeded against `striking-smile` / `production` (optional service selection skipped the first time, then re-run selecting `migration-empirical-test`; the selected service doesn't affect what `config plan` diffs against, since IaC plans the whole project graph).

- [x] **Step 4: Preview only — do not apply**

```bash
railway config plan
```
Expected: a plan showing `@folio/api` being configured to match this file. `striking-smile` already has an **empty, unconfigured** `@folio/api` service shell (id `9b1580c4-4b9b-4ae4-8b33-bb38feafa9f5`, confirmed via `get-service-config` returning "no configuration in this environment" on 2026-09-04) — so the plan should attach source/build/start/healthcheck/env to that existing shell, not create a brand-new service. Reconcile any unexpected diff before Task 9, e.g. if the plan shows it would *delete* variables already set on the real service, that means a var name here doesn't match what's actually on Railway, and the `env` block above must be corrected before Task 9's apply, not silently forced through.

**Actual result (2026-09-04, from the correct worktree checkout):**
```
Plan: 1 to add, 0 to change, 1 to destroy
  + Create service @folio/api
  - Delete service migration-empirical-test
```
This is **not** what was expected, and it's a different kind of diff than the "variable name mismatch" scenario anticipated above — it's a **service-identity mismatch**, not a variable mismatch:
- `- Delete service migration-empirical-test`: expected and fine. This is Task 1's throwaway test service, already flagged (Task 1 Step 9) for manual deletion — `apply` deleting it as a side effect is a convenient bonus, not a problem.
- `+ Create service @folio/api`: **this is the finding to reconcile before Task 9.** `railway config plan` is not recognizing the existing empty `@folio/api` shell (id `9b1580c4-4b9b-4ae4-8b33-bb38feafa9f5`) as an attachable resource — almost certainly because that shell has no `ServiceInstance` record at all (the same underlying quirk Task 1's live execution hit earlier via the MCP tools: `connect-service-source` failed with `"ServiceInstance not found"`, and `update-service` reported success without persisting anything, both against this exact shell). Railway's IaC reconciliation likely only matches against services that already have a `ServiceInstance`, so an instance-less shell is invisible to it — `config apply` would very likely **create a second, separate `@folio/api` service** (new id) rather than fill in the existing shell, leaving `9b1580c4-4b9b-4ae4-8b33-bb38feafa9f5` orphaned (same cleanup category as `migration-empirical-test` — no `delete-service` MCP tool exists, dashboard deletion needed).

**Recommended fix, for Roy to action before Task 9:** delete the empty, unconfigured `@folio/api` shell (id `9b1580c4-4b9b-4ae4-8b33-bb38feafa9f5`) from the Railway dashboard now, the same way `migration-empirical-test` needs deleting. With no stale shell in the way, Task 9's `apply` should then cleanly create the one real `@folio/api` service with no orphan and no ambiguity. Re-run `railway config plan` after deleting it to confirm the plan changes to `1 to add, 0 to change, 1 to destroy` with **no** pre-existing `@folio/api` confusion (i.e., the same output as above minus the surprise — at that point the "create" is expected and correct, since there's genuinely nothing to attach to).

**Resolved (2026-09-04):** Roy deleted the stale shell from the dashboard; confirmed gone via `list-services` (only `migration-empirical-test` remains). Re-ran `railway config plan` from the worktree: `Plan: 1 to add, 0 to change, 1 to destroy` / `+ Create service @folio/api` / `- Delete service migration-empirical-test` — this is now the expected, correct plan (create the real service, remove the now-obsolete Task 1 test service). Ready for Task 9's apply pending Roy's explicit go-ahead and Doppler variables landing on the new service post-creation.

Do **not** run `railway config apply` in this task — that is unchanged. Nothing was applied; only `railway link` and `railway config plan` (a read-only preview) were run.

- [x] **Step 5: Commit**

```bash
git add .railway/railway.ts package.json pnpm-lock.yaml
git commit -m "feat(infra): author Railway IaC config for @folio/api (Render migration)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Doppler → Railway native environment sync

Covers brief item 5 — env vars via Railway's native Doppler integration, not manual re-entry. This must complete before Task 9's `railway config apply`, since every var in Task 2's `env` block is `preserve()`d and needs a real Railway-side value to preserve.

This is a **Roy-executed task**: Doppler's Railway integration is set up from the **Doppler dashboard**, not the Railway side, and is not exposed through any MCP tool available in this session (confirmed via live Railway docs research: "Set it up from the Doppler dashboard; instructions live in the Doppler docs at docs.doppler.com/docs/railway").

**Files:** none — this is a dashboard configuration task, no repo changes.

- [ ] **Step 1: Roy populates Doppler's `prd` config with real production values**

`prd` (project `foliovoyage`) is currently empty aside from Doppler's own auto-injected meta vars — confirmed 2026-09-03. Roy needs to add every real production value for the full var list in Task 2's `env` block above, plus (pending Task 6's outcome) `IMPORT_TRIGGER_SECRET`. In particular, **`DATABASE_URL` and `REDIS_URL`'s real production values are not confirmed anywhere in this session's research** (Render MCP access is disabled) — Roy must supply these from wherever they actually live today, not assume they're already correct in `prd`.

- [ ] **Step 2: Roy sets up the Doppler → Railway integration from the Doppler dashboard**

Per Doppler's own docs (`docs.doppler.com/docs/railway`), from the Doppler dashboard: select project `foliovoyage`, config `prd`, add the Railway integration, and point it at Railway project `striking-smile` (`10a94c58-638f-4597-836f-f00d663185fa`), environment `production` (`1a124cd9-4d95-4c33-af7d-2a261255fb3c`) — the project Roy set up as the actual migration target, not `giving-fascination` (Task 1's sandbox) — **scoped to the environment as a whole, not to a single service**, so both `@folio/api` (Task 2) and `@folio/api-cron` (Task 4) inherit the same synced variables as Railway environment-shared variables, without either needing its own copy.

- [ ] **Step 3: Verify the sync landed — names only, never values**

Once Roy confirms the integration is connected, verify by variable **name** only (never pull real secret values through this session — they must never appear in a transcript). Ask Roy to confirm in the Railway dashboard's Variables tab (environment-level "Shared Variables") that the expected names from Task 2's `env` block appear. Do not call the Railway MCP `list-variables` tool for this verification — its own tool description states values are returned in plaintext with a live session token, which is unnecessary exposure for a check that only needs to confirm names are present.

**Note on `list-variables` as a connected OAuth app:** confirmed 2026-09-04 — the Railway MCP `list-variables` tool's own description states "Connected OAuth apps receive variable names only," and a live call against the new Postgres/Redis services (below) returned `"valuesRedacted": true` with only names, no plaintext. So this tool is actually safe to call from this session for name-only checks; the caution above (written before that was confirmed) still correctly avoids the CLI/personal-token paths, which do return plaintext.

---

### Postgres + Redis provisioning (2026-09-04, ahead of Task 3/9)

Roy chose to provision new Railway-managed resources (`AskUserQuestion`: "Provision new Railway Postgres + Redis" over pointing at an existing external instance). Both now live on `striking-smile`'s `production` environment, declared in `.railway/railway.ts` alongside `@folio/api`:

- **Postgres** (service id `a1183530-a635-42b2-946a-dcead1dfa571`) — image `postgis/postgis:16-3.4` (not Railway's plain `postgres` template), matching `infra/docker-compose.yml`'s local-dev image and the `postgis`/`pg_trgm` extensions `infra/postgres/init/*.sql` creates. 5GB volume (`postgres-volume`).
- **Redis** (service id `45c857f2-1b9e-462d-b995-9a590017f3c1`) — Railway's built-in managed template, landed on `redis:8.2` (no custom-image requirement for Redis, unlike Postgres's PostGIS need).

**Variable names to copy into Doppler `prd`** (values only — never through this session; per Task 3 Step 1/3, only names were read here, via the redacted OAuth-app path noted above): Postgres exposes `DATABASE_URL` (already the private/internal connection string — no separate `_PUBLIC_URL`, since this is a custom-image `service()`, not the plain managed template); Redis exposes `REDIS_URL` the same way. Copy each into Doppler `prd`'s matching key.

**Two IaC bugs hit while declaring Postgres, both now fixed in `.railway/railway.ts`:**

1. **`database()` with a custom `image` doesn't provision what its own IaC node expects.** The live resource lands at address `service.Postgres`, type `service` — but `database()`'s node addresses/types it as `database.Postgres`. That mismatch made `railway config plan` treat the running Postgres as a different resource from the declared one, planning a destructive delete-and-recreate on *every* subsequent apply. Fix: declare it as `service()` directly (matching its true live shape) with explicit `source: image(...)`, `deploy.requiredMountPath`, `networking.privateNetworkEndpoint`, a `volume()` node wired through `volumeMounts`, and every auto-generated env var (Railway-system ones included, e.g. `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`) declared `preserve()` so they aren't pruned. Redis doesn't hit this — the built-in `redis()` factory (no custom image) provisions a genuine `database`-typed resource matching its node exactly.
2. **`volumeMounts` record semantics are reversed from what's intuitive**, per the compiled `normalizeVolumeMounts()` in `railway`'s `dist/index.js`: when the value is a `VolumeNode` (from `volume()`), the **key is the mount path** and the volume's own `.name` supplies its identity. `{ "postgres-volume": postgresVolume }` (name as key) sets `mountPath` to the literal string `"postgres-volume"`; `{ "postgres-volume": { mountPath: "..." } }` (plain object) creates an empty, unlinked `volumeAttachments: {}`. Correct form: `{ "/var/lib/postgresql/data": postgresVolume }` — the real mount path as the key.

**A third issue surfaced only at runtime, not from the IaC diff — a Postgres major-version mismatch left over from the timed-out first apply:**

The first `railway config apply` (run by Roy) got far enough to create the Postgres resource on Railway's *default* managed-Postgres template image (`ghcr.io/railwayapp-templates/postgres-ssl:18`, confirmed via deployment history) before timing out — that ran `initdb` and wrote a `postgresql.conf` with PG18-only settings (`autovacuum_worker_slots`) into the volume. The second, successful apply then swapped the image to `postgis:16-3.4` but reused that same volume, so PG16 crash-looped on every start: `FATAL: configuration file "postgresql.conf" contains errors`. Fixed non-destructively (Roy's choice over wiping the volume): repointed `PGDATA` at a fresh empty subdirectory in the same volume (`/var/lib/postgresql/data/pgdata16`, set live via the Railway MCP `set-variables` tool) so `postgis:16-3.4`'s entrypoint treats it as uninitialized and runs `initdb` fresh — the orphaned PG18 files are harmless and left in place. Confirmed healthy via `list-deployments` (`SUCCESS`) after the redeploy `set-variables` triggered automatically.

**A fourth issue, once Postgres/Redis were healthy: `@folio/api` itself failed its first redeploy against the real `REDIS_URL`.** `apps/api/src/config/env.validation.ts`'s Zod schema requires `REDIS_URL` to match `/^rediss?:\/\//`; the value Roy first copied into Doppler `prd` didn't match it, so `ConfigModule.forRoot`'s validation threw at boot (`Invalid environment configuration: - REDIS_URL: REDIS_URL must be a redis:// or rediss:// URL`), crash-looping the container until `/ready`'s healthcheck timed out the deployment (`get-deployment-diagnosis`: `failureStage: HEALTHCHECK`). Diagnosed without ever viewing the actual secret value (per the "never see/set secret values" constraint) — the validation rule and probable causes (wrong var copied, stray whitespace/quotes, `DATABASE_URL`/`REDIS_URL` swapped) were relayed to Roy, who re-copied the correct value from Redis's Railway Variables tab. The next redeploy (`2406fea6-492d-407b-b904-0f484dbbf58d`) succeeded — deploy logs confirm both `[DatabaseModule] Connected to Postgres` and `[RedisModule] Connected to Redis` before `Nest application successfully started`, i.e. both connections were exercised at boot, not just a platform-level healthcheck pass. `@folio/api` has no public/generated domain yet (`list-domains` returned empty), so this was verified via startup logs rather than an external `/ready` curl.

**Resolved 2026-09-04 (checked `doppler secrets --project foliovoyage --config prd --only-names`, names only):** `@folio/api`'s live variables are missing several vars the IaC declares as `preserve()` — confirmed genuinely absent from Doppler `prd` too, not just unsynced to Railway. Two groups, two different reasons:
- `IMPORT_MEMORY_LIMIT_MB` / `IMPORT_CRAWL_RESTART_MEMORY_PCT` — not a gap. Per the Global Constraints above, BRI-182's memory-restart trigger doesn't exist on this branch yet (only on the unmerged `stewie/bri-182-memory-restart-f192fd`); confirmed via `grep` that neither name appears anywhere in `apps/api/src`. `preserve()`'d pre-emptively for Task 5, which hasn't run. Nothing to add until it does.
- `VIATOR_REQUEST_TIMEOUT_MS`, `DELETE_GUARD_THRESHOLD_PCT`, `IMPORT_CRON_SCHEDULE`, `IMPORT_CRON_ENABLED`, `IMPORT_STUCK_RUN_TIMEOUT_MINUTES`, `IMPORT_CRAWL_RESTART_PAGES` — genuinely absent from `prd`, but harmless: every one has a `.default(...)` in `env.validation.ts:75-169`, and those defaults are the values already tuned from real incidents (BRI-171's 60s timeout, BRI-176's 25-page restart, etc.), not arbitrary placeholders. `@folio/api` is running correctly on schema defaults today.

**Roy's call (2026-09-04): leave as-is, fold into Task 5.** Don't pin explicit Doppler values for the six defaulted vars now; decide alongside Task 5's new memory-restart defaults so it's one Doppler pass instead of two.

---

### Task 4: Cron as a separate Railway service

Covers brief item 4 — cron runs as its own service on Railway's native cron schedule, not bolted onto the always-on web service (Railway cron jobs run *the service's own start command*, so it needs to be a start command that does the one-shot import and exits, not the HTTP server's start command).

`apps/api`'s `nest build` compiles the **entire** `src/**/*.ts` tree per `apps/api/tsconfig.json`'s `include: ["src/**/*.ts"]` — not just `main.ts`'s import graph — so `trigger-import.cli.ts` is already emitted at `dist/modules/import/trigger-import.cli.js` by the exact same build command `@folio/api` itself uses (confirmed by running the build locally and finding that file in `dist/`). Running the compiled JS via `node` (not `ts-node`) avoids a real risk: `ts-node`/`typescript` are `devDependencies` in `apps/api/package.json`, and a production install step that prunes dev dependencies would break a cron service whose start command still needs `ts-node` at runtime. Reusing the same build sidesteps that risk entirely.

Cron schedule and sleep are not expressible in `.railway/railway.ts` (see Global Constraints) — this whole task uses the Railway MCP tools directly instead of the IaC file.

**Files:** none — this is entirely a Railway-side service configuration task, no repo changes beyond what Task 2 already built.

- [ ] **Step 1: Create the empty cron service**

```
create-service
  projectId: "10a94c58-638f-4597-836f-f00d663185fa"
  environmentId: "1a124cd9-4d95-4c33-af7d-2a261255fb3c"
  name: "@folio/api-cron"
```
(no `image` — empty service, source attached next; this creates a genuinely new service in `striking-smile`, distinct from its existing empty `@folio/api`/`@folio/web` shells). Record the returned `serviceId`.

- [ ] **Step 2: Attach the same repo as its source**

```
connect-service-source
  projectId: "10a94c58-638f-4597-836f-f00d663185fa"
  serviceId: <from Step 1>
  repo: "BridgeXconnect/foliovoyage"
  branch: "master"
```

- [ ] **Step 3: Configure root directory, build, start, and cron schedule**

```
update-service
  projectId: "10a94c58-638f-4597-836f-f00d663185fa"
  serviceId: <from Step 1>
  environmentId: "1a124cd9-4d95-4c33-af7d-2a261255fb3c"
  rootDirectory: ""
  buildCommand: "pnpm --filter @folio/api build"
  startCommand: "pnpm --filter @folio/api exec node dist/modules/import/trigger-import.cli.js"
  cronSchedule: "0 3 * * *"
```
`0 3 * * *` matches `IMPORT_CRON_SCHEDULE`'s existing default (`apps/api/src/config/env.validation.ts` — the field documented in `.env.example:53-55`), keeping the same effective nightly time as today.

**Corrected 2026-09-05, after real deploy failures — do not set `rootDirectory: "apps/api"`.** This plan originally specified it (matching `@folio/api`'s own Root Directory), on the assumption the cron service should mirror the web service's config exactly. It doesn't: setting it hides the repo-root `pnpm-lock.yaml` from Railpack's build, which falls back to plain `npm` and can't resolve the `workspace:*` dependency on `@folio/shared` — five straight build failures before this was diagnosed. `@folio/api` itself works with `rootDirectory: "apps/api"` only because of a difference elsewhere in its config not reproduced here; don't extrapolate it. Leave Root Directory empty (repo root) and let `buildCommand`/`startCommand` scope everything via `pnpm --filter @folio/api`, exactly as `@folio/api`'s own working config actually does. Also don't assume Railway persisted the value just because `update-service` reports success — the Root Directory fix above silently failed to persist on its first attempt (config unchanged on a follow-up `get-service-config` read) before a later attempt actually took; always re-read `get-service-config` after any `update-service` call before trusting it.

- [ ] **Step 4: Disable the in-process scheduler on this service specifically**

`trigger-import.cli.ts` boots the full `AppModule` via `NestFactory.createApplicationContext` (`apps/api/src/modules/import/trigger-import.cli.ts:29`), which instantiates `ImportModule` and therefore `ImportScheduler.onModuleInit` (`apps/api/src/modules/import/scheduler.ts:47-79`) — including registering an in-process cron job — before the CLI's own `main()` runs its one-shot `runService.execute("manual"→"scheduled" via cron trigger)` and exits. The registered job never gets to fire in a process that exits within seconds, so this is functionally harmless, but registering a cron job whose schedule text will show up in logs on every single cron firing is confusing noise. Set an explicit override so only this specific service's copy is disabled, leaving `@folio/api`'s own env var (from Doppler, via Task 3) untouched:
```
set-variables
  projectId: "10a94c58-638f-4597-836f-f00d663185fa"
  serviceId: <from Step 1>
  environmentId: "1a124cd9-4d95-4c33-af7d-2a261255fb3c"
  variables: { "IMPORT_CRON_ENABLED": "false" }
  skipDeploys: true
```
(`skipDeploys: true` — this service has no successful deployment yet to redeploy; the value takes effect on its first real deploy, triggered naturally by its first cron firing or a manual `redeploy` once Doppler sync (Task 3) has populated the rest of its inherited environment-shared variables.)

**`DATABASE_URL`/`REDIS_URL` need explicit service-ID references, not by-name ones.** This service's `DATABASE_URL` and `REDIS_URL` must be set to mirror `@folio/api`'s own values (see the "Postgres + Redis provisioning" note above — `@folio/api` itself holds Doppler-synced custom values here, not raw Postgres/Redis plugin references, per `.railway/railway.ts`'s `preserve()` declarations). Set them as:
```
set-variables
  ...
  variables: {
    "DATABASE_URL": "${{492996fa-5ddf-4a86-bec1-d1ff6e1641ac.DATABASE_URL}}",
    "REDIS_URL": "${{492996fa-5ddf-4a86-bec1-d1ff6e1641ac.REDIS_URL}}"
  }
```
`492996fa-5ddf-4a86-bec1-d1ff6e1641ac` is `@folio/api`'s real service ID — confirm it via `list-services` rather than trusting a stale copy of this ID. Use the explicit-ID form (`${{<service-id>.VAR}}`), not the by-name form (`${{@folio/api.VAR}}`): a by-name reference set during this session silently resolved to a stale, unrelated service ID left over from earlier service-naming churn, producing a `P2021` (`ImportRun` table not found) error at runtime that gave no indication the reference itself was wrong — it looked like a real schema/migration problem until traced back to `get-service-config` showing the reference pointed at the wrong ID entirely.

- [ ] **Step 5: Verify the cron field is set correctly**

```
get-service-config
  projectId: "10a94c58-638f-4597-836f-f00d663185fa"
  serviceId: <from Step 1>
  environmentId: "1a124cd9-4d95-4c33-af7d-2a261255fb3c"
```
Confirm the returned config shows `cronSchedule: "0 3 * * *"`, `rootDirectory: ""` (not `"apps/api"` — see Step 3's correction above), the expected build/start commands, and that `IMPORT_CRON_ENABLED` is listed among this service's variable names (value not needed for this check — see Task 3 Step 3's reasoning on not pulling real values unnecessarily). Don't stop at a successful `update-service`/`set-variables` response — re-read `get-service-config` (or a real deployment's logs, for the variable references) to confirm the change actually persisted and resolved correctly, not just that the call returned success.

---

### Task 5: Recalibrate BRI-182's memory-restart trigger for Railway's real ceiling

Covers brief item 6. **Superseded framing, corrected 2026-09-05:** this was written assuming BRI-182's memory-restart trigger lived only on an unmerged branch and needed porting, and assuming Railway's ceiling was 48GB (an unverified guess). Neither held up:

- **The code is already merged.** PR #51 (`stewie/bri-182-memory-restart-f192fd`, commit `391d328` onward) landed on `master` while this branch was diverged. This branch was 11 commits behind; `git merge origin/master` (clean, no conflicts) pulled in the full implementation — `IMPORT_MEMORY_LIMIT_MB`/`IMPORT_CRAWL_RESTART_MEMORY_PCT` in `env.validation.ts`, the `memory-threshold.ts` conversion helper (with its own spec), the `runSegment` trigger wiring in `import.pipeline.ts` (with `import.pipeline.memory.spec.ts` replaying a real heavy-page scenario), and the `segment-worker.cli.ts` call site. There is nothing left to port — this task is recalibration only.
- **Railway's real ceiling is 8GB (8192MiB), not 48GB.** Confirmed directly via `mcp__railway__get-service-metrics` on the live `@folio/api` service: `MEMORY_LIMIT_GB` reports `current: 8, max: 8`, stable across the full 24-hour window (the lower 24h average is a zero-fill artifact from the metric window predating the service's first deployment, not a fluctuating limit). This is Railway's own instrumentation for the actual enforced container limit — the same kind of number Render's 512MiB was, just 16× larger.

**Bundled scope (Roy's call, 2026-09-04, still standing):** this task's Doppler pass also pins explicit `prd` values for `VIATOR_REQUEST_TIMEOUT_MS`, `DELETE_GUARD_THRESHOLD_PCT`, `IMPORT_CRON_SCHEDULE`, `IMPORT_CRON_ENABLED`, `IMPORT_STUCK_RUN_TIMEOUT_MINUTES`, and `IMPORT_CRAWL_RESTART_PAGES` if desired — all six are absent from `prd` and running safely on schema defaults (see the "Postgres + Redis provisioning" note above). Not required by this task; bundle only if convenient.

**Redoing the math from scratch, not rescaling 45% onto the new ceiling:** the evidence behind the original `IMPORT_MEMORY_LIMIT_MB=512` / `IMPORT_CRAWL_RESTART_MEMORY_PCT=45` pairing (`env.validation.ts`'s docstring, BRI-182's decisive real-container test) is workload-driven, not platform-driven — none of it changes on Railway:
- Parent baseline: ~101–118MB flat
- Child's own normal-operation share (20 ordinary pages, real `--memory=512m` container test): ~125–156MB
- Confirmed real single heavy-page rss jump (live crash capture): +96.7MB (`heapUsed` +94.8MB — real V8 heap growth, not buffer retention)
- Heavy-page-spike zone (light baseline + one confirmed jump): ~197–253MB

**The naive-rescale trap:** `45% × 8192MB = 3,686.4MB`. That's outside the entire observed spike zone (197–253MB) — it would never trip under any scenario the evidence actually covers, silently defeating the exact BRI-181 cursor-resume protection this trigger exists for. This is precisely the mistake to avoid: the percentage was never the meaningful number, the absolute MB was.

**Solving fresh against the real 8192MB ceiling:** the two binding constraints from the original derivation still apply and are still workload-evidence-based, not ceiling-based:
1. Threshold must sit comfortably above the normal-operation range with the original ~75–105MB margin → valid window ≥ ~231MB.
2. Threshold must sit inside the real observed heavy-spike zone (197–253MB) → valid window ≤ 253MB.
3. Threshold must sit well below the child's own effective danger ceiling before the *whole container* hits Railway's real limit: `8192 − ~110 ≈ 8,074–8,091MB`. This constraint is no longer binding at all (it was the tight constraint on Render's 512MB, at ~394–402MB); on Railway it's satisfied with enormous headroom regardless of what's chosen inside the [231, 253] window.

Intersecting constraints 1 and 2 gives a valid window of **231–253MB** — the same window as the original derivation, because the workload evidence pinning it hasn't moved. The original **230.4MB** (`45% × 512`) sits essentially at that window's edge and is already the number two independent pieces of real evidence (the decisive container test and the live crash capture) validated as correctly separating "ordinary" pages from the actual BRI-182 incident. Re-deriving lands back on it — not because the percentage was reused, but because the same evidence produces the same answer once you solve for the absolute MB directly instead of inheriting a ratio.

**Recalculated values**, expressing that same 230.4MB threshold as a percentage of the real 8192MB ceiling:

```
IMPORT_MEMORY_LIMIT_MB = 8192            (Railway's real, confirmed per-service ceiling)
IMPORT_CRAWL_RESTART_MEMORY_PCT = 2.8125 (8192 × 0.028125 = 230.4MB exactly)
```

Unlike the earlier draft's "reference constant" workaround (an `IMPORT_MEMORY_LIMIT_MB` that didn't claim to be real), both values here are honest: `8192` is Railway's actual live ceiling, and `2.8125%` is a real, meaningful fraction of it — not an artifact of a wrong assumption about the platform. This also resolves the earlier draft's open design question (whether the two-variable `LIMIT_MB × PCT` shape still made sense against a "reference constant") — it does, now that both operands are real.

**No code change needed.** `env.validation.ts`'s schema defaults (`512` / `45`) stay as-is — they're accurate historical documentation of the Render-era evidence, and the docstring already says "override per deployment tier," which is exactly what this task does via Doppler, matching the pattern already established for the six vars above.

**Files:**
- None modified in `apps/api` (code already merged; defaults intentionally left alone — see above).
- Modify: `apps/api/.env.example` (document the two vars after `IMPORT_CRAWL_RESTART_PAGES`, using the schema's own historical defaults for the example file — not Railway's live-tuned Doppler values, consistent with how `.env.example` documents every other var here).

- [ ] **Step 1: Confirm the merged code's own tests still pass on this branch**

```bash
pnpm --filter @folio/api exec jest src/modules/import/memory-threshold.spec.ts src/modules/import/import.pipeline.spec.ts src/modules/import/import.pipeline.memory.spec.ts
```
Expected: PASS — these came in via the `origin/master` merge; this just confirms the merge didn't break anything on this branch.

- [ ] **Step 2: Document the vars in `.env.example`**

In `apps/api/.env.example`, immediately after line 72 (`IMPORT_CRAWL_RESTART_PAGES=25`), insert:
```

# Ceiling this deployment's whole container is allowed, in MB (BRI-182) —
# paired with IMPORT_CRAWL_RESTART_MEMORY_PCT below to compute the
# memory-pressure segment-restart trigger's absolute byte threshold.
# Optional — defaults to 512 (Render's free-tier limit); every real
# deployment overrides this per its actual platform ceiling (Railway prod
# uses 8192 — see docs/superpowers/plans/2026-09-04-render-to-railway-migration.md Task 5).
IMPORT_MEMORY_LIMIT_MB=512

# Segment-worker restart trigger (BRI-182) — restart once the segment
# worker's own process.memoryUsage().rss crosses this percentage of
# IMPORT_MEMORY_LIMIT_MB. Optional — defaults to 45 (see env.validation.ts
# docstring for the real-evidence derivation; Railway prod uses 2.8125 to
# reproduce the same evidence-backed absolute threshold against the real
# ceiling above).
IMPORT_CRAWL_RESTART_MEMORY_PCT=45
```

- [ ] **Step 3: Commit the `.env.example` documentation**

```bash
git add apps/api/.env.example
git commit -m "docs(api): document BRI-182 memory-restart vars in .env.example (Railway migration follow-up)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Set the recalculated values in Doppler `prd` (Roy runs this — blocked from Claude by the auto-mode classifier, same as the domain-generation and redeploy actions earlier in this migration)**

```bash
doppler secrets set IMPORT_MEMORY_LIMIT_MB=8192 IMPORT_CRAWL_RESTART_MEMORY_PCT=2.8125 --project foliovoyage --config prd
```

- [ ] **Step 5: Verify the values reached Railway and the next deploy picks them up**

After Step 4 and Doppler's native Railway sync (Task 3) propagates the change — confirm via `doppler secrets --project foliovoyage --config prd --only-names` (names only, no values) that both vars now appear, then via `mcp__railway__list-variables` on `@folio/api` (also redacted) that Railway received them. No redeploy is required for these two vars to be *set*, but the running process won't pick them up until its next restart/deploy — note this for Task 9's cutover rather than triggering a redeploy here.

---

### Task 6: Retire or retain BRI-173's external-wake workaround

**Branches on Task 1's Question 1 finding** (`docs/14-railway-migration-task1-findings.md`). Read that file's conclusion before starting this task.

**If Task 1 confirmed Railway services are always-on by default** (the expected, docs-backed outcome): BRI-173 (`.github/workflows/nightly-import-trigger.yml`, `apps/api/src/modules/import/heartbeat.ts`, `ImportTriggerController`, and the `heartbeatUrl`/`RENDER_EXTERNAL_URL` wiring in `ImportRunService`) exists solely to work around Render's inbound-only idle spindown — with `@folio/api` always-on on Railway and cron modeled as its own service (Task 4), nothing in this pipeline is ever asleep to begin with, so the whole mechanism is dead weight. Remove it:

**Files:**
- Delete: `apps/api/src/modules/import/heartbeat.ts`
- Delete: `apps/api/src/modules/import/heartbeat.spec.ts`
- Delete: `.github/workflows/nightly-import-trigger.yml`
- Modify: `apps/api/src/modules/import/import-trigger.controller.ts` — delete entirely (the endpoint's only caller was the now-deleted GitHub Actions workflow)
- Modify: `apps/api/src/modules/import/import.module.ts` — remove the `ImportTriggerController` import (line 9) and `controllers: [ImportTriggerController]` (line 32) plus its docstring paragraph (lines 19-20, 29-31); remove the `heartbeatUrl` line from the `ImportRunService` factory (line 70) and its docstring paragraph (lines 67-69)
- Modify: `apps/api/src/modules/import/import-run.service.ts` — remove the `ImportRunHeartbeat` import (line 4), the `heartbeatUrl` field (lines 103-107), and the `heartbeat.start()`/`heartbeat.stop()` calls (lines 196-197, 236)
- Modify: `apps/api/src/config/env.validation.ts` — remove `RENDER_EXTERNAL_URL` (line 217) and its docstring
- Modify: `apps/api/.env.example` — remove the entire "Nightly import / external wake trigger (BRI-173)" section (lines 87-106), including `IMPORT_TRIGGER_SECRET` and `RENDER_EXTERNAL_URL`

- [ ] **Step 1: Delete the files**
```bash
git rm apps/api/src/modules/import/heartbeat.ts apps/api/src/modules/import/heartbeat.spec.ts apps/api/src/modules/import/import-trigger.controller.ts .github/workflows/nightly-import-trigger.yml
```

- [ ] **Step 2: Remove the wiring in `import.module.ts`, `import-run.service.ts`, `env.validation.ts`, `.env.example`**

Make the edits listed in the Files block above. After editing, `grep -rn "heartbeat\|Heartbeat\|RENDER_EXTERNAL_URL\|IMPORT_TRIGGER_SECRET\|ImportTriggerController" apps/api/src apps/api/.env.example` should return nothing.

- [ ] **Step 3: Run the full test suite**
```bash
pnpm --filter @folio/api test
pnpm --filter @folio/api lint
pnpm --filter @folio/api typecheck
```
Expected: all pass — no remaining reference to any deleted symbol.

- [ ] **Step 4: Commit**
```bash
git add -A
git commit -m "chore(api): remove BRI-173 external-wake workaround (Railway is always-on)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

**If Task 1 found sleep enabled by default, or the result was ambiguous** (the unexpected outcome — contradicts current docs, but Task 1 exists precisely because Roy wanted this checked for real rather than assumed): do **not** delete anything. Instead, keep the full BRI-173 mechanism, but generalize its docs and trigger condition away from Render-specific language:

**Files:**
- Modify: `apps/api/src/modules/import/heartbeat.ts` — update the class docstring (currently Render-specific, describing the 15-minute inbound-only idle timer) to describe the actual observed Railway sleep condition from Task 1's findings instead
- Modify: `apps/api/src/config/env.validation.ts` — rename `RENDER_EXTERNAL_URL` to a platform-neutral name (e.g. `SERVICE_EXTERNAL_URL`) and update its docstring
- Modify: `.github/workflows/nightly-import-trigger.yml` — update `API_TRIGGER_URL` to the new Railway domain (from Task 9's cutover) and its explanatory comments

- [ ] **Step 1: Update the docstrings and env var name to match Task 1's actual findings** (write the exact new docstring text once Task 1's findings file exists — it must describe the *real* observed trigger condition, not a guess)
- [ ] **Step 2: Run the full test suite, lint, typecheck**
- [ ] **Step 3: Commit**
```bash
git add -A
git commit -m "chore(api): generalize BRI-173 wake workaround for Railway (sleep confirmed active)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Update `apps/web`'s `API_BASE_URL`

Covers brief item 8. **Branches on Task 1's Question 2 finding.**

`API_BASE_URL` is read server-side only, in exactly two places: `apps/web/src/lib/api.ts:12` and `apps/web/src/app/go/[slug]/[id]/route.ts:28`, both `process.env.API_BASE_URL ?? "http://localhost:3001"` — a plain runtime env var, not baked into a build, so this is a hosting-platform env var change, not a code change.

**Files:** none — this is a hosting-platform (Vercel, per the Vercel MCP tools available in this environment) env var change, not a repo change.

**If Task 1 confirmed the generated `*.up.railway.app` domain is stable across redeploys:**

- [ ] **Step 1:** Once Task 9's cutover has `@folio/api` live on Railway with a confirmed domain, set `API_BASE_URL` in the web app's hosting platform (Vercel project settings → Environment Variables, Production) to `https://<the @folio/api service's generated domain>`. This is an account-settings change — Roy must confirm the exact value and approve applying it before it's set, per this session's explicit-permission rules around changing account settings.
- [ ] **Step 2:** Trigger a redeploy of `apps/web` (or wait for the next natural deploy) so the new env var takes effect — Next.js reads `process.env.API_BASE_URL` at request time in a server context here, but Vercel env var changes still require a fresh deployment to be picked up by already-running serverless functions.
- [ ] **Step 3:** Verify: load a destination page that calls `fetchDestination` (`apps/web/src/lib/api.ts`) against the production deploy and confirm it renders real data, not a 404/error — confirming the new `API_BASE_URL` actually resolves.

**If Task 1 found the domain is NOT stable across redeploys:** a plain generated-domain env var would silently break on `@folio/api`'s next redeploy. Instead, attach a **custom domain** to the Railway service so the public URL never changes regardless of redeploys:

- [ ] **Step 1:** Ask Roy which subdomain to use for the API (e.g. `api.foliovoyage.com` or similar — depends on what domain(s) Roy actually owns and has access to; do not assume one).
- [ ] **Step 2:** Call the Railway MCP `generate-domain` tool with the `domain` argument set to that subdomain (not omitted, which would generate another unstable `*.up.railway.app` domain) — this returns the DNS records Roy needs to create.
- [ ] **Step 3:** Roy creates those DNS records with the domain's registrar/DNS provider (outside this session's reach).
- [ ] **Step 4:** Call `domain-status` (or `list-domains`) to confirm the custom domain verifies.
- [ ] **Step 5:** Proceed as in the stable-domain branch above, using the custom domain instead of the generated one for `API_BASE_URL`.

---

### Task 8: Update `CLAUDE.md` and docs

Covers brief item 9.

**Files:**
- Modify: `CLAUDE.md:186`

- [ ] **Step 1: Update the BRI-176 reference in `CLAUDE.md`**

Current text (line 186, inside the "Ingest pipeline" section's `TourValidator`/upsert bullet — actually the surrounding bullet on `ImportRunService`/segment-worker processes):
```
  ...`undici`'s response-decoding memory is fully released between segments
  (BRI-176) — this keeps the nightly crawl inside Render's 512MiB free-tier
  limit.
```
Replace `"this keeps the nightly crawl inside Render's 512MiB free-tier limit."` with:
```
  this keeps the nightly crawl's memory profile bounded regardless of host
  (originally sized against Render's 512MiB free-tier limit; migrated to
  Railway — see BRI-182's IMPORT_MEMORY_LIMIT_MB / IMPORT_CRAWL_RESTART_MEMORY_PCT
  for the current evidence-based thresholds).
```

- [ ] **Step 2: Add a short "Deployment" note to `CLAUDE.md`**

Add a new subsection after the "Local secrets — Doppler, not a copied `.env` file" section (before "## Commands"), since there is currently no deployment-platform documentation anywhere in `CLAUDE.md` or `docs/`:

```markdown
## Deployment — Railway

`apps/api` runs on Railway (project `striking-smile`), not Render — migrated
2026-09 (see `docs/superpowers/plans/2026-09-04-render-to-railway-migration.md`
for the full migration plan and rationale). Two services in one environment:

- `@folio/api` — the HTTP server, config-as-code via `.railway/railway.ts`
  (monorepo `rootDirectory: "apps/api"`), health-gated on `/ready` (real
  DB+Redis dependency check, not the bare `/health` liveness probe).
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
```

- [ ] **Step 3: Commit**
```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for the Railway migration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Cutover and rollback

Covers brief item 10. This is the task where Render traffic actually stops and Railway traffic starts — the highest-blast-radius task in this plan. **Do not start this task without Roy's explicit go-ahead on the reviewed plan**, and confirm with Roy on the `@folio/web`-still-in-Railway discrepancy (Global Constraints) before starting, in case it changes cutover ordering.

**Files:** none — this task is a sequenced set of live operations, not a code change.

- [ ] **Step 1: Pre-cutover checklist**
  - [ ] Task 1 findings recorded and committed.
  - [ ] Task 2 Step 4's real preview (2026-09-04) showed `+ Create service @folio/api` / `- Delete service migration-empirical-test` — the delete is expected (Task 1 cleanup), but the create means the pre-existing empty `@folio/api` shell (id `9b1580c4-4b9b-4ae4-8b33-bb38feafa9f5`) is not recognized by IaC reconciliation (no `ServiceInstance` on it). **Before this step**, delete that empty shell from the Railway dashboard, then re-run `railway config plan` and confirm it now shows a clean `1 to add, 0 to change` (or similar) with no lingering ambiguity, before proceeding to Step 2's apply.
  - [ ] Task 3's Doppler sync confirmed live (names verified in the Railway dashboard).
  - [ ] Task 4's cron service confirmed configured correctly (Task 4 Step 5).
  - [ ] Task 5's BRI-182 port merged and tested.
  - [ ] Task 6 executed per Task 1's actual branch.
  - [ ] Roy has confirmed which subdomain (if any) to use for `apps/web`'s `API_BASE_URL`, per Task 7.
  - [ ] Roy has clarified the `@folio/web` Railway service discrepancy (in both `giving-fascination` and `striking-smile`).

- [ ] **Step 2: Apply the real IaC config**
```bash
railway config apply
```
(Roy-executed, from a terminal already `railway link`ed per Task 2 Step 3.) Review the plan Railway shows before confirming — it should show only `@folio/api`'s settings being set to match Task 2's file, no unexpected deletions of existing variables (if it does, stop and reconcile before confirming, per the `railway config apply` docs' own destructive-change confirmation gate).

- [ ] **Step 3: Verify `@folio/api` is live and healthy on Railway**

`curl -sS https://<@folio/api's Railway domain>/ready` — expect `200` with a body confirming both `database` and `redis` report healthy (per `apps/api/src/health/readiness.controller.ts`).

- [ ] **Step 4: Run a real import against the new host** (this is also Task 10's first step — do not duplicate the run, just don't consider cutover complete until Task 10 passes)

- [ ] **Step 5: Cut `apps/web` over** (Task 7)

- [ ] **Step 6: Monitor** — watch `get-logs` (Railway MCP) for `@folio/api` and `@folio/api-cron` for the first real nightly cron firing (up to 24h, since the schedule is `0 3 * * *` UTC) before considering Render fully decommissionable.

- [ ] **Step 7: Rollback path** (keep available until Step 6's first unattended cron firing is confirmed clean — do not decommission Render before then)
  1. Revert `apps/web`'s `API_BASE_URL` (Vercel project settings) back to the Render URL (`https://atlas-api-oagl.onrender.com`, per BRI-173's workflow file / this plan's Task 6 diff for the exact prior value) and redeploy.
  2. Render's service is untouched by this entire plan (Global Constraints: "don't touch Render") — it should still be running as-is and able to serve traffic immediately once `apps/web` points back at it, with no Render-side action needed to "turn it back on."
  3. If Task 6 removed BRI-173, note that reverting to Render **without also reverting Task 6's deletion** leaves Render's nightly cron unable to fire again (the in-process `ImportScheduler` can't run while Render's instance is asleep, and the wake mechanism is gone) — a real rollback past Step 6 needs `git revert` on Task 6's commit too, not just the `apps/web` env var.

- [ ] **Step 8: Decommission Render** — only after Step 6's first clean unattended cron firing, and only with Roy's separate explicit go-ahead (Render is out of scope for this plan's own actions — "don't touch Render" — so this step is Roy's own action, this plan just marks the point at which it becomes safe).

---

### Task 10: Final live verification

Covers brief item 11.

**Files:** none.

- [ ] **Step 1: Real live import test on the new host**

Trigger a real run against the new `@folio/api` deployment — either let `@folio/api-cron`'s next scheduled firing happen naturally, or trigger one manually via the Railway dashboard's "run now" on the cron service (there is no MCP tool for an ad hoc cron trigger). Watch `get-logs` for the run's full lifecycle: fetch → normalize → resolve locations → resolve prices → validate → upsert → link, ending in a `succeeded` `ImportRun` record (mirroring `trigger-import.cli.ts`'s own `console.log(JSON.stringify(run, null, 2))` output, visible in the cron service's logs).

- [ ] **Step 2: Confirm cron fires unattended**

Do not manually trigger the *next* firing — wait for the natural `0 3 * * *` UTC schedule to fire on its own, and confirm via `get-logs`/`list-deployments` on `@folio/api-cron` that a deployment started at the expected UTC time with no manual intervention.

- [ ] **Step 3: Confirm BRI-182's threshold holds under real load**

During Step 1 or Step 2's real run, check `get-logs` for `@folio/api-cron` (or `@folio/api` if a segment worker logs there) for the `[BRI-182 mem]` diagnostic line already on this branch (`apps/api/src/modules/import/import.pipeline.ts:258-263`) — confirm the logged `rss` values stay within the same real-world range this task's Task 5 evidence assumed (roughly 125-402MB), validating that the recalibrated `IMPORT_MEMORY_LIMIT_MB`/`IMPORT_CRAWL_RESTART_MEMORY_PCT` defaults from Task 5 are sized correctly against real Railway-hosted behavior, not just the Render-hosted evidence they were derived from. If real Railway-hosted memory behavior differs meaningfully from the historical Render numbers, flag this back to Roy — Task 5's thresholds may need a follow-up adjustment with fresh evidence.

- [ ] **Step 4: Report results to Roy**

Summarize Steps 1-3's outcomes (import succeeded end-to-end, cron fired unattended at the right UTC time, memory stayed in the expected range) before considering this migration complete.
