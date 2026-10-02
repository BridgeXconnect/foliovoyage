# Scope: content engine, AI tour copy (BRI-154, BRI-201)

The first generated content type, AI tour copy (BRI-154, rows 8 to 10), and its sampled evaluation (BRI-201, row 11). See the legend in [index.md](index.md#legend) for the status words and the feature lifecycle.

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
