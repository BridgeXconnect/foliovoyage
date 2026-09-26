# 0003. Sampled evaluation and kill switch for AI tour copy: rationale

This is the decision record for [index.md](index.md). It holds the reasoning behind the build spec, so `/develop` can skip it.

## Context

Spec 0002 (BRI-154) generates one short paragraph per eligible tour and blocks it with a deterministic check before it is stored. That check is fast and free, and it runs on every paragraph. It also has known limits, and BRI-201 (ST-50) exists to cover them:

- **The check cannot judge truth.** It compares digits, counts sentences and words, measures word overlap, and looks for price and cancellation language. A sentence such as "Guides lead you through the old quarter" passes if the words overlap enough, even when the tour data never mentions a guide.
- **Spelled out numbers are not compared.** The allowed digit runs come from the source fields, but "twelve guests" is never checked. 0002 left this gap to BRI-201 on purpose.
- **Voice counters are computed and thrown away.** `emDash`, `contrastiveReveal`, and `clicheOrIntensifier` exist in the check result and are never stored or printed. Nobody can say whether the voice is drifting.
- **Failed text is never stored.** A failure exists only as reason codes, so it cannot be replayed later.
- **No withdrawn state exists.** `TourCopy.status` has only `published` and `failed`. There is no way to pull good looking but bad copy without deleting it.
- **There is no golden set.** A prompt or model change can ship with no fixed test set to run against.

Some facts from the repository that shaped the design:

1. The read path (`resolveAiSummary` in `apps/api/src/destinations/destination.service.ts`) already serves `aiSummary` only when the row is `published`, the grounding hash matches, and the tour is still eligible. A row in any other status is already hidden, so a `withdrawn` status needs one new test and no new read logic.
2. `TourCopyService.generateOne` treats a row with an unknown status as "regenerate". A `withdrawn` row would therefore be rebuilt on the next nightly run with the same prompt, so it needs its own skip rule. A skip rule alone is not enough, because the same run would still publish new tours at the pulled pair, so `tour-copy:run` also refuses to start there.
3. The web app does not render `aiSummary` yet (scope row 9). The gap between "published" and "a visitor sees it" is invisible today, which is the cheapest time to add a check like this.
4. The gateway limit of 5 metadata entries, the `content_type` entry, and the shared monthly spend rule all come from 0002. The judge is a second kind of call through the same gateway.
5. The BRI-206 `SpendGuard` in `modules/research` guards DataForSEO requests, which are paid per request and outside the gateway. Model calls already have gateway spend rules, so the guard is not reused as is. Only its per run cap idea is reused (`TOUR_COPY_EVAL_MAX_JUDGMENTS`).
6. The CLI pattern from 0002 (dry run by default, `--execute`, `--limit`, checks before database access) is the house style for anything that spends money.
7. Roy's comment on BRI-201 says the ticket framing "is not locked in", so the five open questions were decided in the design conversation, not read off the ticket.

The context brief settled these before the interview began: blocking is the model (a failed check falls back to provider text and retries once), price, rating, and cancellation are excluded categorically (BRI-204), rubric 2b is defined (does the copy lead with one specific, checkable fact), cost is not the constraint, and the judge model must differ from the generator (Sonnet 5). This spec does not reopen those. The judge model moved more than once after the interview, and the Judge model note under Options considered records the whole path.

## Options considered

### Option 1: Judge a published sample in a separate command, withdraw by version and model (chosen)

A command picks a sample of already published paragraphs, asks a judge model to list every claim against the source, stores each verdict, and withdraws every published row of a prompt version and model pair if too many pages have a bad claim.

- **Pros**: Adds no latency or cost to generation. Verdicts are stored, so agreement with a human can be measured. Withdrawal is reversible and uses the read path that exists. Judge cost is bounded by a per run cap. A prompt problem, which is systematic, is handled at the level where it happens.
- **Cons**: A bad page stays live until the next eval run. One bad page below the limit is reported, not withdrawn. The judge is a model and can be wrong.

### Option 2: Judge every paragraph inline before it is stored

Add the judge call to `generateOne`, after the rule check, so nothing unjudged is ever published.

- **Pros**: No bad page is ever live. No sampling design is needed.
- **Cons**: Doubles the model calls for every tour and adds latency to each. The judge would run on the roughly 2500 tour nightly ceiling even when the prompt has not changed. It also removes the natural "sample and decide about the whole version" view, which is the useful signal, because a single verdict per page says nothing about a prompt. It would also mix a slow, expensive, occasionally wrong check into the path that 0002 kept fast and deterministic.

### Option 3: Human review only

Roy reads pages, with no automated judge.

- **Pros**: The most trusted signal. No model cost.
- **Cons**: Does not scale past a few dozen pages, and there are about 2500 eligible tours. It puts Roy's time on every prompt change. The brief asks for a check that runs before any prompt or model change, and a human cannot be that gate for every change. The chosen option keeps the human spot check for calibration, which is where a human adds the most value.

### Sub decisions inside Option 1

**Kill switch trigger.**
- *Chosen: one threshold on the judged sample (more than 5% bad, at least 30 judged).* One number that Roy can reason about, and it matches how the brief framed "a threshold across a sample".
- *Runner up: two tiers (for example 2% contradicted, 10% unsupported).* More precise about severity, and rejected because "contradicted" against "unsupported" is the judge's finer distinction, which is the least reliable part of its output. One threshold on "any bad claim" uses the judge where it is strongest.
- *Rejected: withdraw a single page on one bad verdict.* The judge false positive rate would then pull good pages all the time.

**What is withdrawn.**
- *Chosen: every published row of the (prompt version, model) pair.* Prompt failures are systematic. The same prompt on Haiku and on Sonnet behaves differently, so the model belongs in the key. The rows exist because of that pair, and all of them carry the same risk.
- *Runner up: the prompt version alone.* Would pull good Sonnet rows because a Haiku experiment failed.
- *Rejected: per city.* Cities share the prompt. A city level failure is more likely a data problem, which the sample report shows anyway.

**How it is withdrawn.**
- *Chosen: a new `withdrawn` status, text kept.* Reversible and auditable, and the read path already hides non `published` rows.
- *Runner up: a boolean `withdrawn` flag.* Two fields that can disagree (`status = published` and `withdrawn = true`), and every reader must remember both.
- *Rejected: delete the copy.* Loses the evidence and the ability to restore a false alarm.

**Regeneration after a withdrawal.** The cross check found that skipping a withdrawn row only while its grounding hash is unchanged leaves two holes: a changed tour would be regenerated at the same bad pair and republished, and new tours would keep publishing at the pair the judge just pulled.
- *Chosen: `tour-copy:run` refuses to start (exit 1, names the pair) while the pair has withdrawn rows, and the service skip rule ignores the hash.* Simple, visible, and it uses state that already exists. Restore, a prompt version bump, or a model change lifts it.
- *Runner up: a pair state table.* Closes the one remaining gap (going back to an old pair after its withdrawn rows were regenerated elsewhere), and adds a table and a second source of truth. Left as a follow up.
- *Restore and the rubric version.* A rubric bump discards a pair's verdicts, so it lifts the restore refusal without new evidence. The stamp key includes the rubric version, so CI fails until the golden run is repeated, and that is the control.

**Judge model.** *Chosen: `claude-opus-5-5` through the same gateway. This is the final decision.* The reason is maximal independence: a different model and a higher tier than the Sonnet 5 generator, so the judge shares neither its blind spots nor its capability ceiling, and it is the safest available choice against missing subtle claims. Comparing a claim with the source text it quotes does not need Opus's full capability, but nothing about the task makes Opus a poor fit either. Cost is not a reason in either direction.
- *Runner up: Claude Haiku 4.5.* A different model, on the allowlist and, per the brief, already proven on this gateway in BRI-154 calibration, and a natural fit for mechanical judging. Not chosen because a smaller model is the weaker defense against missed subtle claims, which is the failure that matters most here. There is no fallback tier in this spec, since the decision is final.
- *Rejected: Claude Sonnet 5.* The generator's own model, so it fails the independence rule. It was the judge in one intermediate version of this spec, see History.
- *History, so the record is straight.* In the interview round the pick recorded for this question was Opus 5.5 (the question said Sonnet 5 generates, so the judge must differ). A later brief moved the judge to Sonnet 5, which dropped the independence rule. A second brief chose Haiku 4.5 and restored the rule. A third brief, marked final, returned to Opus 5.5 for maximal independence. The wording here is written for that final reason, not copied from the interview draft.
- *What this costs.* Opus 5.5 has no prior proof on this gateway. Sonnet 5 and Haiku 4.5 were both confirmed in BRI-154 calibration, and Opus was not, so its model string, routing, gateway cost and forced tool behavior are first confirmed in build task 13, a real gate and not a formality. The string `claude-opus-5-5` comes from the model list in this session's environment, the same list whose Sonnet 5 and Haiku 4.5 strings match the repo's `TOUR_COPY_ALLOWED_MODELS`. Nothing in the repo names an Opus model, and the string has not been checked against Anthropic's live API, which is what task 13 does.
- *Rows the judge model generated.* The startup check compares the configured models, but selection works on each row's stored `model`, so a stored row could name the judge model (today's 0002 allowlist keeps Opus out, but the column is free text). Because `model` is part of the pair key, a pair is either entirely `same_model` or has no such rows, so AC-7 skips the whole pair, counts it as `same_model`, and never withdraws it automatically (it has no judge verdicts to count). Manual withdraw still works. The judge never grades its own output. Skipping rows whose model merely differs from the configured generator was considered and rejected, because it would make rows from an earlier model, such as a Haiku experiment, impossible to judge or withdraw, which breaks the pair level kill switch.

**Judge output shape.** A list of claims, each with a verdict and a quote from the source. The quote is the important part. A model can say "supported" about anything, and code can check that the quoted text really appears in the source. A claim marked `supported` or `contradicted` with a quote that is not there is downgraded to `unsupported` and flagged. So the judge's own output is partly self checking, and a made up "supported" cannot pass.

**Judge and human storage.** One `TourCopyEval` table with an `evaluator` column, not columns on `TourCopy`. A verdict must stay tied to the exact text judged (`copyGeneratedAt`, `judgedText`) even after the row is regenerated, and judge and human rows must sit side by side so agreement is a simple query. Columns on `TourCopy` would be overwritten by the next regeneration. The human note lives inside the `claims` JSON, so there is no second free text column.

**Voice rubric 2b.** Reported and warned, never used to withdraw. Weak style is a quality problem, and the copy is still grounded and safe. This matches 0002, where voice counters are also non blocking. The `duration` opening share is a separate cheap signal that needs no model call, since it was the failure PR #78 fixed.

**Sampling.** The first 50 rows of a pair are all judged, then every city gets a floor of 60 (or all its rows if fewer). Early volume is where a new prompt shows its failure, and a city floor stops the sample from being all one city. Rows judged before are never judged again, so repeated runs top up rather than repeat.

**Human spot check.** An interactive terminal prompt, one page at a time, recording `human` rows. A JSON file round trip would be one more artifact to lose. Interrupted sessions resume, since each answer is saved at once.

**Golden set.** The two part design in AC-14 and AC-15 solves a label problem. There are no known good labels for real tours, because failed text was never stored and no human has read the published copy at scale. So the golden set is made of two things with different jobs:
- **Part A tests the judge.** Planted bad paragraphs have known labels by construction (Roy and I wrote the defects), so recall is measurable. The 60 reference paragraphs, which Roy reviewed as clean, give a measurable false positive rate.
- **Part B tests the prompt.** It generates fresh copy for the same 60 tours, runs the inline check, and has the (now trusted) judge grade it. Part B only means something if Part A passed, and the run stops there if it did not. A failed judge call (invalid, refusal, API error) fails the part instead of leaving the denominator, and Part B needs at least 30 judged paragraphs, so a prompt that mostly fails the inline check cannot pass on a handful of survivors.

**Golden gate.** A committed stamp keyed by a hash of everything that could change the result (prompt, both default models, rubric version, golden data), checked by a Jest test that needs no secrets. The stamp is written only when both effective models equal their defaults, so it cannot certify models that were never run, and the Jest gate lands in the same commit as the first stamp so CI is never red in between. This makes "run the golden set before any prompt or model change" a CI failure, not a habit. The trade off is that the stamp is self reported (see Consequences), and promptfoo would give nicer reports but adds a dependency and does not, by itself, block a merge.

**Storage of golden data.** Committed JSON in the private repo, which reproduces in every worktree and CI. R2 or local files would need a secret or a manual step to run the test.

**Notification.** Stdout and exit code 2 only. The eval is a manual command today. When it moves to the Railway cron, a non zero exit surfaces in the existing job monitoring. A message integration would be a new surface for a command that has not run twice yet.

**Sequencing with BRI-152.** Tour copy goes first. BRI-152 (guides and collections) needs a rubric that also checks a stated curation rule, and that rubric cannot be written well before tour copy has been judged for real. The rubric registry keyed by content type (AC-17) gives BRI-152 a slot without designing its content now.

## Rationale

**The judge must be less noisy than the switch it drives.** This is the part I got wrong first, and it changed one number, so it is worth spelling out. The kill switch trips when more than 5% of judged pages have a bad claim. A judge that wrongly flags 5% of good pages would trip a 5% switch about 45% of the time at the smallest sample (30 pages) and about 46% at 50 pages, even when every paragraph is perfect. Setting the false positive ceiling equal to the withdraw limit does not make noise harmless, it makes noise a coin flip. So the golden set demands at most 2% false positives, a judge that flags 1% of good pages trips a perfect pair only about 4% of the time at 30 pages, and `--restore` (refused while the numbers still cross) is the recovery path for the rest.

You chose 5% in the interview for the judge bar. I moved it to 2% for the reason above, and it is called out in the summary so you can override it. If you keep 5%, raise the withdraw limit or the minimum sample so the two numbers are not the same size.

**Sample, then decide about the pair.** A single bad page tells you about one tour, and a rate over a sample tells you about a prompt. Prompt and model changes are the events that create risk, and they change every row of a pair at once. Withdrawing at the pair level matches where the cause is.

**Withdraw is safe because fallback already exists.** Provider text is what a page shows when there is no AI copy. Pulling a pair costs no page anything except the generated paragraph. That is why the threshold can be modest and the action can be automatic, where a design that left pages empty would need more caution.

**Blocking stays cheap and the judge stays a sample.** Layer 1 runs on 100% of paragraphs at no model cost. The judge, which costs money and can be wrong, runs on a sample. Putting the expensive uncertain check on every paragraph would spend most of its budget confirming the cheap check.

**Spelled out numbers become a blocking check, not judge only.** "Twelve guests" is deterministic to detect, so the rule check is the right place, and the judge is the backstop for what a word list cannot see (`one`, ordinals, invented facts with no number at all). The word list deliberately leaves out `one` and ordinals, since blocking them would fail good copy for ordinary phrases.

**Opus 5.5 as judge, chosen for maximal independence.** A judge that is the same model as the generator can share its blind spots, and a weaker one can miss subtle claims, so the judge is a different model at a higher tier. The task does not need Opus's full capability, but nothing about it makes Opus a poor fit, and it is the safest available choice against missed claims. The price is that it is unproven on this gateway, which build task 13 settles first. The design still does not rely on the judge alone: it must quote the source for every verdict and code checks the quote, Part A measures recall on planted defects including 4 subtle ones, and a human reads 30 pages and the agreement is reported. The judge's misses on real copy are the thing calibration should watch most closely.

## Assumptions to verify at calibration

These could not be verified from the repository and are carried into build task 13:

- The Cloudflare AI Gateway name and the `gateway.ai.cloudflare.com` URL come from Doppler, and generation calls already route through it. Per the brief, Sonnet 5 and Haiku 4.5 were both confirmed through it in BRI-154 calibration (the repository holds the generator allowlist entries, not the calibration record). Opus 5.5 has never been called through it, so task 13 is its first real confirmation. The judge's own calls (`content_type` `tour_copy_judge`) still need one real call to confirm they show a nonzero cost in the gateway log, because spend limits depend on a proven cost.
- The judge's 90 second timeout and 1500 `max_tokens` are starting values. A source with many claims could hit the token limit, in which case the tool call is cut short and the result is invalid (`judge_invalid`).
- The 50 and 60 sampling numbers, the 30 minimum sample, and the 80% `leadsWithFact` warn floor are starting values. Roy's first spot check and the first full run should tune them.
- The generator's proven call uses `thinking: disabled` and no tools, no `tool_choice`, no `tools` array (`tour-copy-anthropic-generator.ts`). The judge call adds a `record_verdict` tool with a forced `tool_choice`, so that part is not proven by generation, whichever model judges. One real call in task 13 must show the gateway passes the tool definition and forced choice through and that a valid tool result comes back. Thinking is disabled on both, which is compatible with a forced tool choice.
- Part A's planted defects were written by people, so a 90% recall there does not prove the judge catches the generator's own natural mistakes, even with an independent judge. The first spot check's agreement report is the real evidence.
- The judge's 90 second timeout and 1500 `max_tokens` were set without any Opus call, and Opus may be slower than the models used so far. Task 13's first call is where they get their first real check.
- The judge sets `cache_control` on its rubric system prompt, but caching only takes effect above a minimum prompt length that differs by model (0002 needed PR #77 to clear it for Sonnet 5). The Opus minimum is not known from the repository. If the rubric prompt is under it, cache reads stay at zero and the run summary shows that. Check the cache read total at calibration.

## References

Sources only. No web fetch was done for this spec.

- `docs/specs/_root/0002-ai-tour-copy/index.md` and `rationale.md`: the parent spec (AC-1 to AC-19, the Check details section, the Follow up that names BRI-201).
- `apps/api/src/modules/content/tour-copy.service.ts`, `tour-copy-check.ts`, `tour-copy-check.constants.ts`, `tour-copy-prompt.ts`, `tour-copy.cli.ts`: the current generation, check, prompt, and CLI code this spec extends.
- `apps/api/src/destinations/destination.service.ts` (`resolveAiSummary`): the read path that already hides non `published` rows.
- `apps/api/prisma/schema.prisma` (`model TourCopy`) and migration `20260922032212_add_tour_copy`: the current columns.
- `apps/api/src/config/env.validation.ts`: where the new env vars go.
- `apps/api/AGENTS.md`: NestJS conventions, the ingest pipeline, and the Jest layout (specs next to source, integration specs separate, CI unit tests run with no secrets).
- `docs/scope/_root/scope.md`: rows 8 to 10 (AI tour copy, web render, nightly generation), and the row format used for enrollment.
- The BRI-206 `SpendGuard` pattern in `apps/api/src/modules/research`: the per run cap idea.
- Linear BRI-201 (parent BRI-120) and its comment from Roy that the framing "is not locked in".
- The BRI-201 context brief (pasted by Roy on 2026-09-25): the settled decisions and the five open questions.
- Pull requests #76, #77, and #78 (gateway BYOK header fix, prompt cache minimum, and the opening sentence variety fix): the recent changes to the prompt and adapter that the version bump and the opening pattern counter build on.
