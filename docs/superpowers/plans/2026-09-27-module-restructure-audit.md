# Module restructure audit and consolidated plan

Date: 2026-09-27. Status: **plan only, nothing executed.**

Audits the three Copilot-written restructure plans (`CONTENT_`, `IMPORT_`, `RESEARCH_MODULE_RESTRUCTURE_PLAN.md`, in `~/Downloads`) against the live repo, and adds the BRI-214 shared-types assessment as a fourth, separately sized piece.

Everything below was checked against the repo, Linear, GitHub and the worktrees on 2026-09-27. Where something is inferred rather than observed it says so.

---

## 1. Summary

- **The target layouts are structurally fine.** Nothing in any plan creates a cross-feature technical-layer dir (`controllers/`, `services/`). Research and import are cycle-free under their proposed layouts. Content is not.
- **None of the three plans is safe to run as written.** All three miss runtime breakers that unit tests won't catch:
  - `__dirname`-relative file paths that break when a file moves one directory (research, content, import).
  - Entry-point paths hard-coded in `package.json` scripts and in the **production cron** config (`.railway/railway.ts`).
  - External importers outside the module (including a production serving path).
  - Files the plans never mention (content: 15 of 36; import: 4).
- **Content's plan is built on things that don't exist** (a Nest module, `content.service.ts`, `TOUR_COPY_GENERATOR`/`TOUR_COPY_JUDGE` DI tokens). It predates BRI-201 (PRs #79–#85). It needs a rewrite, not corrections.
- **Cheapest single fix across all three:** *leave every CLI entry point at its current path* (module root). That removes the package.json/Railway/`__dirname` problems for research and import in one decision, and no plan needs a `cli/` folder.
- **Order:** research now, BRI-214 in parallel now, import after BRI-218 merges, content after BRI-201 closes. Detail in section 7.
- **BRI-214 is smaller and different than the ticket implies.** `packages/shared` already exists but holds legacy static-content types, not the API contract. The drift is already real (see section 6). Sized S–M, ~1.5–2.5 days including a spike.

---

## 2. NestJS feature-vs-layer check

`apps/api/src` is grouped by feature at the top level: `affiliate, common, config, database, destinations, health, prisma, redis, search, modules/{content,import,research}`. That matches Nest's recommended structure.

Layer folders proposed *inside* one feature (`core/`, `resolvers/`, `persistence/`, `orchestration/`, `stages/`) are fine, and dependency direction inside each is acyclic for research and import.

Caveats:

1. **`content/` and `research/` are not Nest feature modules.** Neither has a `*.module.ts` or DI providers. They are plain TS plus CLIs. Only `import/` has Nest modules (`import.module.ts`, `import-core.module.ts`, `import-segment-worker.module.ts`; tokens `VIATOR_HTTP`, `RAW_ARCHIVE_STORE`, `LOCATION_CACHE`, `QUARANTINE_STORE` in `import-core.module.ts`). Every "update the Nest module if it exists" phase in the content and research plans is moot.
2. **Cross-feature coupling exists today and the plans hide it:**
   - `destinations/destination.service.ts:3-4` (production serving path) imports `modules/content/tour-copy-eligibility` and `tour-copy-grounding-hash`.
   - `research/*` imports `import/curated-cities` and `import/http/allowlist-fetch`.
   - `prisma/seed.ts` and `search/search.integration.spec.ts` import `import/curated-cities`.
3. **Barrels:** all three plans add `index.ts` with `export *`. Do not. Barrels within a feature invite folder-level cycles (`from "../core"`) and `export *` name collisions that no plan checked. The one legitimate barrel is a **narrow public API for `content/`** exposing only what `destinations/` consumes (see 5).
4. Longer term, `import/` is arguably three features (crawl/ingest, location+price resolution, experience linking/promotion). Not in scope now.

---

## 3. Cross-cutting corrections (apply to all three)

| # | Problem | Fix |
|---|---|---|
| X1 | `apps/api/package.json` scripts hard-code CLI paths: `import:run` → `import/trigger-import.cli.ts`; `experience:promote` → `import/promote-experience.cli.ts`; `research:hub` → `research/research.cli.ts`; `tour-copy:run`, `tour-copy-eval:run`, `tour-copy-withdraw:run`, `tour-copy-spotcheck:run`, `tour-copy-golden:run`, `tour-copy-golden:snapshot` → `content/*.cli.ts`. The plans say "don't delete files referenced by scripts" but never say to update the scripts. | **Keep CLI entry points at module root.** If a CLI ever moves, update the script in the same commit. |
| X2 | `.railway/railway.ts:151`, service `@folio/api-cron`: `node dist/modules/import/trigger-import.cli.js`. Moving that file breaks the nightly cron. No test covers it; changing live Railway config is a deploy action and needs Roy's explicit go-ahead. | `trigger-import.cli.ts` and `segment-worker.cli.ts` **do not move**. |
| X3 | `__dirname`-relative runtime paths (unit tests use fakes and won't catch them). See per-module sections. | Grep `__dirname` and `import.meta` before every move; add a smoke test that resolves each path. |
| X4 | Docs and comments go stale: `apps/api/AGENTS.md` (lines ~20, 37, 38, 54, 122, 131, 140), `.claudeignore`, `docs/06-viator-api-integration-guide.md`, JSDoc `import("./…")` and `{@link}` paths. Untracked `research/AGENTS.md`, `content/AGENTS.md` and `CLAUDE.md` exist in the `repo-audit-agents-5e8f2a` worktree and will go stale too. | Add an explicit "update docs" step per phase. Grep for the old basenames. |
| X5 | Squash-merge makes merged branches look ahead of `master`. | Cross-check branch state against PR state before judging "in flight". |
| X6 | Plans say `validate` = build only. | Per phase: `pnpm --filter @folio/api typecheck && lint && test`, plus `test:integration` for import, plus `nest build` and a `node dist/...` smoke run of every CLI (`--help` or dry-run) so a compiled-path break shows up. Note `prisma/seed.ts` is outside tsconfig `include`, so **typecheck won't catch it**: run `prisma:seed` against a scratch DB or grep. |

---

## 4. Research plan: corrections

State today: 13 impl, 9 spec files, no cycles under the proposed layout, no in-flight work (no dirty files in any worktree, no open PRs).

1. **Silent data-loss bug (critical).** `research.cli.ts:41-45` derives `RESEARCH_DATA_DIR = resolve(__dirname, "../../../research-data")`, `REPO_ROOT = resolve(__dirname, "../../../../..")` and `RULE_FILE` from `REPO_ROOT`. The ledger is `join(dataDir, "ledger.jsonl")`. Moving the CLI into `cli/` shifts `__dirname` one level, so the data dir moves from `apps/api/research-data` to `apps/api/src/research-data` and the **monthly spend ledger silently restarts at $0**, defeating the spend guard. `apps/api/research-data/` is gitignored (absent in the main checkout), so nothing flags it. Fix: keep `research.cli.ts` at the root (X1), and independently resolve paths from one exported constant, not `__dirname` arithmetic.
2. **Spec list is wrong.** The plan invents `candidates.stage.spec`, `demand.stage.spec`, `serp.stage.spec`, `classify.stage.spec`, `catalog-reader.spec`. Real specs: `candidates`, `classify`, `hub-stages`, `price-table`, `research.cli`, `rule`, `search-provider.client`, `spend-guard`, `viator-catalog`. `hub-stages.spec.ts` is unmapped. Rewrite the spec table from the real list.
3. **Import edges into `import/` change with depth.** `candidates.stage.ts → ../import/curated-cities`; `viator-catalog.ts`, `research.cli.ts`, `search-provider.client.ts` and two specs → `../import/http/allowlist-fetch`. After research moves these become `../../import/…`, and the later import restructure must update them again (see section 5 I5). The plans claim independence; they are not independent.
4. **Phase 9 (Nest module) is moot.** No research module exists; `research.service.ts (if created)` is speculative.
5. **Drop `cli/` and barrels.** With the CLI at the root the layout is `core/ pricing/ stages/ providers/`, and `index.ts` files are unnecessary.

**Sequencing:** safe now. **Worth doing?** Yes, reduced: 13 files is a small module, so the payoff is modest, but it is low risk and doubles as a pilot for the method (path grep, smoke test, docs step) before touching import. ~0.5 day.

---

## 5. Import plan: corrections

State today: 32 impl, 24 spec files. Folder graph under the plan's layout is acyclic (`core → clients, config`; `resolvers → http, core`; `persistence → resolvers, core`; `orchestration → all lower`; `cli → orchestration, config, persistence`). The layering is sound.

1. **Worker spawn breaks (critical).** `segment-runner.ts:45`: `join(__dirname, "segment-worker.cli.js")`. The plan puts `segment-runner` in `orchestration/` and `segment-worker.cli` in `cli/`; every import run's child spawn would fail at runtime. Tests fake `SegmentRunner`. Fix: `segment-worker.cli.ts` stays at the root (also required for X2), and `segment-runner.ts` either stays with it or resolves the path explicitly. Simplest: keep both at root.
2. **Fixtures break (critical for tests).** `normalizer.spec.ts:9`, `price-resolver.spec.ts:14`, `location-resolver.spec.ts:323` use `join(__dirname, "__fixtures__", …)`. Moving the specs into `core/` and `resolvers/` leaves `__fixtures__` behind. Fix: change those to a shared `FIXTURES_DIR` helper, or move the fixtures with their specs. Decide once.
3. **Unmapped files:** `backfill-reference-price.cli.ts`, `promote-eligible.cli.ts`, `promote-experience.cli.ts` (all `AppModule` bootstrap CLIs; the last is a package.json script) and `import-run.integration.spec.ts`. Leave the CLIs at the root (X1).
4. **`import/` externals the plan misses:** `app.module.ts:9 → import.module`; `prisma/seed.ts:3 → curated-cities` (not typechecked); `search/search.integration.spec.ts:4 → curated-cities`; both `experience-linker*.integration.spec.ts → ./curated-cities`; research (section 4 item 3). If `curated-cities.ts` moves to `config/`, all of these change in the same PR.
5. **Check the `import-core.module.ts` import block** against actual `./location-resolver` imports (lines 13-16) after the move. The plan's block is only roughly right.
6. **New files from BRI-218 need placement** (they exist only in the `bri-217-coordinate-coverage-b85c00` worktree today): `location-candidates.ts`, `position.ts`, `backfill-experience-coordinates.cli.ts` (+ specs), `storage/raw-archive.reader.ts`. Provisional homes: `location-candidates` and `position` → `resolvers/`; the backfill CLI stays at root (X1); `raw-archive.reader` stays in `storage/`.
7. **Stray remote branch `origin/refactor/restructure-import-module`.** No PR, 5 files, garbled commit messages (tool-call JSON leaked into the messages), and `resolvers/price-resolver.ts` on it actually contains `LocationResolver` types. Its `core/index.ts` re-exports from the old root files. It is a broken partial attempt. **Do not build on it. Recommend deleting it, but only with Roy's go-ahead.** It will also collide on paths with the real restructure if left.
8. **Deploy contract:** after the move, run `nest build` and check `dist/modules/import/trigger-import.cli.js` and `segment-worker.cli.js` still exist at those paths.

**Sequencing:** **blocked until BRI-218 merges.** BRI-218 is Backlog in Linear but has 16 uncommitted paths in `bri-217-coordinate-coverage-b85c00` (branch `stewie/bri-218-experience-coordinate-resolution`, 0 commits ahead): `curated-cities.ts`, `experience-linker.ts` (+ integration spec), `import.pipeline.ts` (+ spec), `location-resolver.ts` (+ spec), `prisma/schema.prisma`, `package.json`, plus the new files above. Two notes the brief didn't have:
- It **changes the Prisma schema** (needs a migration, which must be reviewed and applied before or with the merge).
- `normalizer.ts` is *not* dirty there, despite being named in the brief. `curated-cities.ts` and `import.pipeline.ts` are, and both are in the plan's move list.

Also resolve `stewie/import-run-script-fix-bc32b7` first (1 commit, no PR, edits the `import:run` script so the segment worker can spawn; both touch `package.json`).

**Worth doing?** Yes, this is the module where a flat layout hurts most (32 impl + 24 spec files, 3 Nest modules). With CLIs and runner/worker pinned at the root, the real move set shrinks (rough estimate, about 20 impl files; recount against the final map). ~1–1.5 days, run after BRI-218.

---

## 6. Content plan: corrections

State today: 36 impl, 34 spec files. **The plan needs a rewrite.**

1. **Nonexistent things.** No `content.module.ts`, `content.service.ts`, `TOUR_COPY_GENERATOR`/`TOUR_COPY_JUDGE` tokens or provider factories. Phase 9 and every "keep the DI tokens" instruction are moot. The plan's stated generator imports ("imports from tour-copy.constants") don't match reality.
2. **15 impl files and 15 specs are never mentioned:** `tour-copy-check.constants`, `tour-copy-eval-sample`, `tour-copy-eval.cli`, `tour-copy-generate-checked`, `tour-copy-golden-snapshot.cli`, `tour-copy-golden.cli`, `tour-copy-golden.fixtures`, `tour-copy-golden`, `tour-copy-judge-startup-check`, `tour-copy-judge.fake`, `tour-copy-opening`, `tour-copy-run-summary`, `tour-copy-served`, `tour-copy-spotcheck.cli`, `tour-copy-withdraw.cli`. The plan even imports `../service/tour-copy-run-summary` from the CLI without ever moving that file.
3. **The layout creates cycles.** `tour-copy-anthropic-generator.ts` (`generation/`) imports the type `TourCopyStartupConfig` from `tour-copy-startup-check.ts`, which the plan puts in `cli/`, while `cli/tour-copy.cli.ts` imports the generator: **`generation ↔ cli`**. Same for `evaluation → tour-copy-judge-startup-check`. The startup checks are config validation, not CLI code. Also `evaluation → generation` (judge imports `TourCopyUsage`), acyclic but odd; and `tour-copy-eval-stats.ts` / `tour-copy-eval-sample.ts` import `PrismaService`, so they are not "pure evaluation".
4. **Runtime path break (critical).** `tour-copy-golden-data.ts:20`: `GOLDEN_DIR = join(__dirname, "golden")`, plus `GOLDEN_TOURS_FILE`, `GOLDEN_SEEDED_FILE`, `GOLDEN_STAMP_FILE`, `GOLDEN_REFERENCES_DRAFT_FILE`. The plan moves it to `service/`, breaking the golden and stamp lookups; `tour-copy-golden.cli.ts` writes the stamp there. Fix: move `golden/` together with `golden-data.ts`, or key the path off an exported anchor.
5. **External production importer:** `destinations/destination.service.ts:3-4` imports `content/tour-copy-eligibility` and `tour-copy-grounding-hash` (used at lines 45, 53: `evaluateTourCopyEligibility`, `computeGroundingHash`). If those move, the public site's serving path breaks. Give `content/` a **narrow `index.ts` public API** (eligibility + grounding hash only) and have `destinations/` import that. It is the one barrel worth having, and it makes the coupling visible.
6. **Revised layout (proposal):**
   - `core/`: constants, eligibility, grounding-hash, source-text, numbers, prompt, check + check constants, opening, served, **startup-check types**
   - `generation/`: generator, anthropic-generator, generate-checked, prompt-dependent code
   - `evaluation/`: judge, anthropic-judge, judge-result, judge-rubric, judge-log, judge-startup-check, judge.fake, eval constants, eval-stats, eval-sample, eval service, run-summary, and `golden/` (data + the golden `.ts` files, together)
   - root: `tour-copy.service.ts`, all `*.cli.ts` (X1), `index.ts` (public API)
   - Every file needs an explicit home. Re-run the cycle script against the final map before starting.
7. **Staleness:** `apps/api/AGENTS.md` still says content is "not yet called by any pipeline, cron or route", while `destination.service.ts` calls it. Fix as part of the docs step.

**Sequencing:** **blocked** on both:
- **BRI-201 calibration.** Task 13 is unfinished: the golden run failed the clean bar once (fixed via 7 reference edits) and stopped twice on Anthropic credit. No stamp exists. BRI-201 stays open until a clean golden run passes and the stamp is committed. Branch `stewie/bri-201-task13-calibration` (worktree `bri-201-sampled-eval-qa-898ae9`) has 2 unmerged commits (`18edded` golden set data, `61b7bb2` judge logging) touching the judge, eval CLI/service, golden files and golden JSON, plus untracked `GOLDEN-REVIEW.md` and draft/proposed references JSON.
- **Uncommitted edits** to `tour-copy-anthropic-generator.ts`, `tour-copy-prompt.ts` and `tour-copy.constants.ts` in worktree `viator-normalization-audit-06e84a` (branch `pricing-calibration-sonnet5-b2e4b3`, 0 commits ahead). Land or discard before starting.

**Worth doing?** Yes, but only as the rewritten version. 70 files flat is real clutter and the content work is still moving, so the value is real; the risk is highest because of golden files and a serving-path dependency. ~1 day after unblock. Do it last.

---

## 7. Execution order

| Step | Work | Gate | Est. |
|---|---|---|---|
| 0 | Housekeeping decisions (no code): approve or reject deleting `refactor/restructure-import-module`; land or drop `stewie/import-run-script-fix-bc32b7`. | Roy | minutes |
| 1a | **Research restructure**, corrected (section 4). | none | ~0.5 d |
| 1b | **BRI-214 shared wire types** (section 8). Independent of the three restructures; touches `destinations/destination.types.ts` and `apps/web/src/lib/api.ts` only. Can run in parallel with 1a. | none | ~1.5–2.5 d |
| 2 | **Import restructure**, corrected (section 5). | BRI-218 merged (incl. its Prisma migration); step 0 done | ~1–1.5 d |
| 3 | **Content restructure**, rewritten (section 6). | BRI-201 closed (stamp committed); generator/prompt/constants edits resolved | ~1 d |

Per-step mechanics (same for each):
1. Recheck the gates; fresh `git log`/worktree scan for new in-flight edits to files in the move list.
2. Regenerate the cycle report against the final mapping (scratch script used for this audit: `…/scratchpad/graph.js`; note its regex false-positives on JSDoc `import("./…")` links).
3. `git mv` in small commits (history follows moves); one folder per commit.
4. Grep for `__dirname`, `join(`, `resolve(`, `.json`, `require.main` in every moved file.
5. Update `package.json`, external importers, AGENTS.md/docs (X1, X4).
6. Validate with X6, including compiled-CLI smoke runs.
7. **No deploy** without Roy's explicit go-ahead. Any Railway config change is a deploy action.

Cross-step note: step 1a rewrites research's `../import/…` imports; step 2 must update them again if `curated-cities` moves. To avoid the double edit, either leave `curated-cities.ts` at the import root (recommended, it is already imported from 6 places) or accept the second edit.

---

## 8. BRI-214: shared wire types (independent fourth piece)

### What the ticket implies vs what's there

- BRI-214 (Linear, Backlog, Low) says `apps/web` hand-maintains `ApiExperience`/`ApiDestination` in `apps/web/src/lib/api.ts`, cast unchecked (`(await res.json()) as ApiDestination`, `api.ts:86`), and EP-15 generation work will add fields the web must read.
- **A workspace package already exists**: `packages/shared` (`@folio/shared`, type-only, `main/types/exports → ./src/index.ts`, no build step, `type: "module"`). It is wired into web (`workspace:*`, `transpilePackages`, jest mapper). So the answer is *not* "create `packages/types`" but "put the wire contract in the existing package".
- Its current content (`PriceBand`, `ExperienceCategory`, `Experience`, `Destination`) is the **legacy static-editorial model**, not the API response. It is shaped differently and shares names with the wire types (`Experience`, `Destination`), so wire types need their own namespace (subpath export `@folio/shared/api`) to avoid confusion.
- `apps/api` does **not** depend on `@folio/shared`. The two mentions in `destination.types.ts:14` and `destination.service.ts:198` are comments ("mirrors `@folio/shared`'s `PriceBand`"). `PriceBand` is defined three times (api types, web `lib/api.ts`, shared).

### Drift that exists today

- API `ExperienceResponse` has `aiSummary: string | null` (BRI-154). Web `ApiExperience` has **no** `aiSummary` and nothing in `apps/web/src` references it. This is exactly the silent drift the ticket describes, already live: the API ships a field the web can't see and nothing fails.
- `DestinationResponse`/`PaginationMeta` ↔ `ApiDestination`/`ApiPagination` and `PriceBand` are hand-mirrored.

### Current blast radius (smaller than it sounds)

- Web's only live API read is `fetchDestination` (`lib/api.ts`) → `GET /v1/destinations/:country/:city`. The other consumer is the `/go` route POSTing to `/v1/affiliate-clicks`.
- Search on web is **not** wired to the API: `search-experiences.ts` says the static content is the source and the live `GET /v1/search` swap is future. The API already has `SearchResponse` types waiting, so the drift risk grows sharply when that lands, and with the BRI-131/132 map endpoints and EP-15 fields (BRI-154/152/205).
- Web has no `zod`; the API does (`^4.4.3`).

### Options

| | Option | Solves | Cost |
|---|---|---|---|
| A | Move wire types into `@folio/shared/api`; API and web `import type` | compile-time drift; one `PriceBand` | S |
| B | A **plus** Zod schemas in shared, web parses at the fetch boundary | runtime drift (API deployed ahead of web, or vice versa) | M |
| C | A/B plus a contract test in the API that validates real controller output against the same schemas | drift caught in CI before deploy | M |

Recommendation: **A + B, with C's test for the destination endpoint.** Runtime validation is the piece that actually addresses "no runtime validation", and types alone would have left `aiSummary` missing.

### Risks to settle in a spike first (~0.5 day)

1. **`nest build` layout risk (inferred, not tested).** `apps/api/tsconfig.json` has no `rootDir`. If the API imports a `.ts` file from `packages/shared/src` via the workspace symlink, TypeScript may treat it as a source file, widen the inferred root and **change `dist/` layout**. That would break `dist/modules/import/trigger-import.cli.js`, which the Railway cron runs. Test with `nest build` and diff the `dist/` tree. If it shifts, options: give `@folio/shared` a small build step emitting `.d.ts`/JS, or set `rootDir`/`paths` deliberately. This is the main sizing unknown.
2. **Module format.** `@folio/shared` is `type: "module"` with TS entry; the API is CommonJS. Type-only imports are erased so runtime is fine, but Zod schemas must only be *consumed at runtime* by web (ESM, already transpiled via `transpilePackages`). The API should use `z.infer` types only (or the contract test, under jest, which needs the `moduleNameMapper` the web already has). If the API ever needs the schemas at runtime, the package needs a real dual/CJS build.
3. **Zod version pin** must match across api/web/shared (add to shared as a dependency, not peer surprise).
4. **Turbo:** `packages/shared` has no `build`; `dependsOn: ["^build"]` is harmless today but adding a build step would put it on the critical path of `typecheck`/`lint`/`test` for both apps.

### Sizing

Spike 0.5 d; move types and fix `aiSummary` 0.5 d; Zod boundary in web with error handling and tests 0.5–1 d; contract test 0.5 d. **Total ~1.5–2.5 days.** Independent of the three restructures, no shared files. Not "bigger" than the restructures in effort, but larger in payoff per day: it fixes a live bug class rather than tidying. Recommend starting it in parallel with research now, before more endpoints add fields.

Update Linear BRI-214's description to reflect the existing package and the concrete `aiSummary` case.

---

## 9. Does anything change whether the original plans are worth doing?

| Plan | As scoped | Verdict |
|---|---|---|
| Research | Mostly fine, wrong spec list, one data-loss path bug, moot Nest phase | Do, reduced. Small win, useful pilot. |
| Import | Sound layering, misses worker-spawn, fixtures, 4 unmapped files, prod cron entry point | Do after BRI-218, with CLIs and runner/worker pinned to the root. Most value. |
| Content | Built on nonexistent module/tokens, 15 files unmapped, creates a cycle, breaks golden path, misses a production importer | **Rewrite, then do last.** As written it is not executable. |
| BRI-214 | Not a restructure; the workspace exists, real bug already live | Do now, in parallel, as its own story. |

The single most valuable design decision across all of it: **entry points and their `__dirname` assumptions stay put.** It costs a few files not moved, and it removes every deployment and silent-runtime hazard the plans introduced.

---

## 10. Decisions (Roy, 2026-09-27)

1. Delete `origin/refactor/restructure-import-module`: **yes. Done.**
2. CLI entry points stay at module root: **yes.** Applies to all three restructures.
3. `curated-cities.ts` stays at the import root: **yes.** Removes the research double-edit and six external call-site changes.
4. BRI-214 starts now, in parallel with research: **yes.**
5. Land `stewie/import-run-script-fix-bc32b7`: **yes.** Rebased onto master (its `package.json`/`AGENTS.md` conflicted with the new content/research scripts), verified `nest build` emits both compiled CLIs, pushed, PR #86 open (merge and Linear link type "contributes" left to Roy). This is the change BRI-195 was reverted over.

Consequences for the sections above: step 0 in section 7 is done pending PR #86 merging; the import layout drops `config/` for `curated-cities` (only `memory-threshold` remains a candidate for it); the "double edit" note in section 7 no longer applies. The audit stays a repo doc only, no Artifact copy.

## 11. Progress log

- 2026-09-27: `origin/refactor/restructure-import-module` deleted.
- 2026-09-27: `stewie/import-run-script-fix-bc32b7` rebased onto master and pushed, PR #86 (BRI-195).
- 2026-09-27: BRI-214 implemented on `stewie/bri-214-shared-wire-types`, PR #87. Spike result for section 8 risk 1: **did not materialise.** With the API importing shared types via `import type`, `nest build` emits an identical `dist/` file tree and no `@folio/shared` in the JS, and API typecheck/jest resolve the package without a `moduleNameMapper`. Scope shipped: destination endpoint only (types + Zod schemas, web fetch-boundary parse, contract assertion in `destination.service.spec`). Actual effort was well under the 1.5-2.5 day estimate. Search types deliberately left API-local. Research restructure not started.
- 2026-09-27: PR #86 and #87 merged (squash). Post-merge checks: **#86** real `import:run` against the `dev` Doppler config (dev Neon): the worker child spawned from `dist/`, segment 1 scanned 1000 products (917 outside curated destinations, 82 normalized), upserted them in batches of 44 and 38, stopped on the memory threshold with "cursor persisted for the next segment", and segment 2 spawned. The run was then stopped by hand (SIGTERM), which can leave an orphaned `ImportRun` row in dev. **#87**: no route calls `fetchDestination` any more (`/destinations/[slug]/[city]` only 308-redirects), so there was no page to render. Instead the real `fetchDestination` was run against a live API on the `prd` DB with the session forced read-only (`default_transaction_read_only=on`, guard verified first): real data for all 7 cities (paris, bali, rome, kyoto, lisbon, bangkok, hanoi) parsed against the schema, including the non-null `aiSummary` case. The web schema has no live production caller until BRI-168 surfaces DB data on the canonical cards.
- 2026-09-27: BRI-219 research restructure on `stewie/bri-219-research-restructure`, PR #88. Additions the audit missed: the two moved specs read `docs/research/bri-206/rule.md` via `__dirname` (one more `../`), and `hub-stages.spec.ts` stays at the root next to the CLI it tests. Pre-existing flake found: `import.pipeline.memory.spec.ts` fails intermittently under parallel turbo runs (task chip raised).
