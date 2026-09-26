# Scope: BRI-206 hub page validation (Folio Voyage, product name Atlas)

Folio Voyage is a travel affiliate platform with curated destination guides and bookable experiences. This scope started as one slice: two cheap experiments that decide which hub page types (BRI-205) are worth designing at all (rows 1 to 7). It now also carries the first generated content type, AI tour copy (BRI-154, rows 8 to 10) and its sampled evaluation (BRI-201, row 11). It spans both apps, so it lives in `_root`.

**Build approach:** Tracer Bullet (prove the whole path on one city with real calls first, then widen to six).
**Workflow:** Alpha (after develop, run check verify). The project default level of rigor. `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Any feature can carry its own tag (for example `· GA`) to do more or less.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| A | Viator import pipeline and curated cities | Existing | existing |
| B | Hand written destination pages for six cities | Existing | existing |
| 1 | Search data access and spend guard | Foundation | in-progress |
| 2 | Pursue or skip rule, written first | Foundation | in-progress |
| 3 | Candidate list from the catalog (one city) | Slice 1 | in-progress |
| 4 | Demand check (one city) | Slice 1 | in-progress |
| 5 | Results page pull and domain classes (one city) | Slice 1 | in-progress |
| 6 | Widen to all six cities | Slice 2 | planned |
| 7 | Findings and hand off to BRI-205 | Slice 3 | planned |
| 8 | AI generated tour copy (`ai_summary`) | Content engine | in-progress |
| 9 | Show AI tour copy on the web | Content engine | planned |
| 10 | Nightly AI tour copy generation | Content engine | planned |
| 11 | Sampled evaluation and kill switch for AI tour copy (BRI-201) | Content engine | in-progress |

## Already built (for context)

### A. Viator import pipeline and curated cities · existing
Nightly crawl of Viator products for six curated cities, with location and price resolution, quarantine, and an idempotent upsert. It does not fetch attractions or tag names today. code in `apps/api/src/modules/import/`

### B. Hand written destination pages for six cities · existing
Static editorial pages for Bangkok, Kyoto, Hanoi, Rome, Lisbon and Bali, with Viator links attached by a one time match. code in `apps/web/src/data/destinations.ts`

## Foundations

### 1. Search data access and spend guard · in-progress
A safe way to call the search data provider you already chose, with credentials handled the project way and a hard cap so the monthly ceiling cannot be crossed by accident. Nothing in the repo wires this up yet. code in `apps/api/src/modules/research/`
**Done when:** one cheap test call works with project managed credentials, a spend cap refuses any call that would pass the budget, and every call's cost is written to a log.
- [x] Design it (spec): [0001](../../specs/_root/0001-hub-page-validation/index.md), child [0001-search-data-access-and-spend-guard.md](../../specs/_root/0001-hub-page-validation/0001-search-data-access-and-spend-guard.md)
- [x] Build it: `/develop search data access and spend guard`
  - [x] Env vars, gitignore and script wiring (AC-5)
  - [x] Spend guard, ledger, cache and client with specs (AC-1 to AC-5)
  - [x] One real cheap call checked against the provider dashboard (AC-2)
- [x] Verify it: `/check verify search data access and spend guard`

### 2. Pursue or skip rule, written first · in-progress
The rule that turns a classified results page into a pursue or skip call, plus how a domain is put in one of four classes (marketplace, big publisher, forum, small site). It must exist before any results page is pulled, so the data cannot bend the rule.
**Done when:** the rule, the class definitions, and the threshold (for example three or more small sites in the top ten) are saved in a dated file before the first results page is fetched.
- [x] Design it (spec): [0001](../../specs/_root/0001-hub-page-validation/index.md), child [0002-pursue-or-skip-rule.md](../../specs/_root/0001-hub-page-validation/0002-pursue-or-skip-rule.md)
- [ ] Build it: `/develop pursue or skip rule, written first`
  - [ ] Rule file written from the spec and signed off by Roy (AC-6)
  - [ ] Commit first gate in the results stage (AC-6)
- [ ] Verify it: `/check verify pursue or skip rule, written first`

## Slice 1: one city, end to end

### 3. Candidate list from the catalog (one city) · in-progress
List the attractions and tags the Viator catalog holds for one city, ranked by product count and rating, and cross them with the page type query shapes into a ranked list of candidate queries. Tags come free from the tour rows already in the database, tag names need one Viator call, and attractions need a short spike to see whether they carry counts.
**Done when:** one city has a ranked candidate query list with counts and ratings, saved as a file.
- [x] Design it (spec): [0001](../../specs/_root/0001-hub-page-validation/index.md), child [0003-candidate-list.md](../../specs/_root/0001-hub-page-validation/0003-candidate-list.md)
- [ ] Build it: `/develop candidate list from the catalog (one city)`
  - [ ] Tag ranking from Tour rows and tag names file (AC-7, AC-8)
  - [ ] Attractions spike and ranking, then query templates (AC-7, AC-8)
- [ ] Verify it: `/check verify candidate list from the catalog (one city)`

### 4. Demand check (one city) · in-progress
Send that city's candidate queries to the search data provider in one batch to see which ones people really search for, and keep the raw responses so nothing is paid for twice.
**Done when:** each candidate has a demand figure or a clear no data mark, the batch cost is a few cents and logged, and raw responses are saved.
- [x] Design it (spec): [0001](../../specs/_root/0001-hub-page-validation/index.md), child [0004-demand-check.md](../../specs/_root/0001-hub-page-validation/0004-demand-check.md)
- [ ] Build it: `/develop demand check (one city)`
  - [ ] Keyword Overview batch with limits check and no_data marks (AC-9)
  - [ ] Full city run through the guard (AC-9)
- [ ] Verify it: `/check verify demand check (one city)`

### 5. Results page pull and domain classes (one city) · in-progress
For the queries that pass the demand check, fetch the results page, put each domain in a class under the rule from row 2, and count small sites in the top ten. Runs only after row 2 is saved.
**Done when:** each validated query has a classified top ten and a pursue or skip call by the written rule, with every domain's class visible.
- [x] Design it (spec): [0001](../../specs/_root/0001-hub-page-validation/index.md), child [0005-results-page-pull.md](../../specs/_root/0001-hub-page-validation/0005-results-page-pull.md)
- [ ] Build it: `/develop results page pull and domain classes (one city)`
  - [ ] Thin thread: three hand picked queries end to end (AC-10, AC-11, AC-12)
  - [ ] Classifier, unlisted report and per family verdicts (AC-11, AC-12)
  - [ ] Full city results pull (AC-10)
- [ ] Verify it: `/check verify results page pull and domain classes (one city)`

## Slice 2: all six cities

### 6. Widen to all six cities
Repeat rows 3 to 5 for the other five cities, checking the running spend before each batch.
**Done when:** all six cities have a call per query family, and total spend stays under the budget and is logged.
- [ ] Build it: `/develop widen to all six cities`

## Slice 3: the answer

### 7. Findings and hand off to BRI-205
Roll the results up per page type family into a pursue or skip table, with the evidence and the total cost, so BRI-205 can design only what earned it.
**Done when:** one table has a call per page type family with its evidence and cost, and it is linked from BRI-206.
- [ ] Build it: `/develop findings and hand off`

## Content engine: tour copy (BRI-154)

### 8. AI generated tour copy (`ai_summary`) · in-progress
The first real model integration. A separate command writes a short paragraph for each eligible tour from its standard Viator fields only, through a Cloudflare AI Gateway, checks it for price, cancellation and invented facts, and stores it in a new `TourCopy` table. The destination API serves it as `aiSummary` only while its grounding hash and the eligibility gate still hold. code in `apps/api/src/modules/content/`
**Done when:** about 8,850 eligible tours have a stored paragraph or a recorded failure reason, the gateway and console spend limits are proven by a real test, and `GET /v1/destinations/:country/:city` returns `aiSummary` for a tour whose copy is current.
- [x] Design it (spec): [0002](../../specs/_root/0002-ai-tour-copy/index.md)
- [ ] Build it: `/develop AI generated tour copy`
  - [x] Table, grounding hash and a thin thread on a fake generator, with the API read path (AC-1, AC-3, AC-4, AC-12, AC-16)
  - [ ] Prompt, blocking check, corrective retry and skip rules (AC-2, AC-5, AC-6, AC-7, AC-13, AC-15)
  - [ ] Env config and the Anthropic adapter through the gateway (AC-9, AC-10, AC-11, AC-13, AC-14)
  - [ ] The `tour-copy:run` command with dry run, limits and abort rules (AC-8, AC-9, AC-14, AC-15, AC-17, AC-18, AC-19)
  - [ ] Cloudflare and Anthropic setup, calibration and the first backfill, done by Roy (AC-5, AC-9, AC-10, AC-18)
- [ ] Verify it: `/check verify AI generated tour copy`

### 9. Show AI tour copy on the web · planned · needs a decision · from spec 0002
Render `aiSummary` on the destination page next to the provider description, escaped as untrusted text, and decide whether it carries a visible label. Add the field to the web type.
**Done when:** a destination page shows the generated paragraph for tours that have one and the provider text for the rest.
- [ ] Design it (spec): `/architect show AI tour copy on the web`

### 10. Nightly AI tour copy generation · planned · from spec 0002
Wire the generation command into a Railway cron so new and changed tours get copy each night, with the two gateway variables added to Doppler `prd`. Needs Roy's go ahead before any deploy.
**Done when:** a nightly run generates copy for tours that are new or whose grounding hash changed, and its summary is readable in the service logs.
- [ ] Build it: `/develop nightly AI tour copy generation`

### 11. Sampled evaluation and kill switch for AI tour copy (BRI-201) · in-progress · from spec 0002
A separate judge command (Claude Opus 5.5, a different model from the Sonnet 5 writer) samples published tour copy, lists each claim as supported, unsupported or contradicted with a quote from the source, and stores the verdicts in a new `TourCopyEval` table. If more than 5% of at least 30 judged pages carry a bad claim, every published row of that prompt version and model is withdrawn (reversible), and `tour-copy:run` refuses to run at that pair until it is restored. A golden set tests the judge and the prompt before a change ships, and a 30 page human spot check keeps the judge honest. Needs Roy's go ahead before any deploy. code in `apps/api/src/modules/content/`
**Done when:** the judge has scored a sample of published copy through the gateway with verdicts stored, a pair over the bad claim limit is withdrawn and can be restored, and the golden set has passed with its stamp committed and enforced by a test.
- [x] Design it (spec): [0003](../../specs/_root/0003-tour-copy-eval-harness/index.md)
- [ ] Build it: `/develop sampled evaluation and kill switch for AI tour copy`
  - [x] Table, withdrawn read path and skip rule, then a thin thread on a fake judge with the kill switch (AC-1, AC-2, AC-7, AC-8, AC-9)
  - [x] Stronger inline check, prompt version 4 and the extracted generate loop (AC-3, AC-4, AC-18)
  - [x] Judge rubric, env config and the Anthropic judge adapter through the gateway (AC-5, AC-6, AC-12, AC-17, AC-19)
  - [x] Sample selection, withdraw and restore, and the spot check commands (AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-19)
  - [ ] Golden data and command, then Roy's calibration and the committed stamp (AC-5, AC-9, AC-14, AC-15, AC-16)
- [ ] Verify it: `/check verify sampled evaluation and kill switch for AI tour copy`

## Deferred
Out of scope for the current build pass, kept so the plan stays honest.
- **Durable run history table for tour copy (`TourCopyRun`)**: left out of spec 0002 to keep the schema small, add it if gateway logs prove too short lived · needs a decision
- **Batch API for tour copy**: only worth it if the catalogue grows well past 30,157 live tours, and the gateway must support it first · needs a decision
- **Reusable command for reruns and a future 100 cities**: about $4 by the strategy estimate, but you chose a one off with saved raw results · needs a decision
- **Rank the next cities to add by demand times catalog depth**: a second use of the same candidate list (strategy section 1.5) · needs a decision

## Legend

**The decision box.** Every feature that needs a decision carries exactly one, the sub task whose label ends with `(spec)`. Skills locate it by that `(spec)` suffix, never by an exact label. Every other box is an execution box and `/architect` never ticks one.

**Feature lifecycle**:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | `/architect` at spec capture | `Design it` ticked, spec linked, `Build it: /develop <feature>` with 2 to 5 milestones, then `Verify it` (Alpha and up) |
| `in-progress` (building) | `/develop` | milestone boxes tick one by one, code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` and milestones ticked, `Verify it` ticked |
| `done` | you, when you decide it is | boxes you ran ticked, skipped ones marked skipped; for Alpha, after `/check verify` is the suggested point |

- **Next step** is the first unticked box.
- **needs a decision** means run `/architect` first; otherwise go straight to `/develop`.
- **Status** goes `planned`, then `in-progress`, then `done`, plus `existing` (built before this workflow) and `dropped`.
- **Workflow** (header line) is the project default. Alpha means `/check verify` after `/develop`, with no separate test suite or review.
