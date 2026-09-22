# 0002. AI generated tour copy: decision record

Build spec: [index.md](index.md)

## Context

> ⚠️ Premise note: the brief and the code disagree in a few places, and this spec resolves them rather than following the brief silently. (1) The BRI-206 spend guard keeps its ledger and cache in local files and says its month total "only sees this machine's ledger". That does not survive `@folio/api-cron` on Railway, where the disk is wiped. This feature does not port it: model calls go through a Cloudflare AI Gateway, which holds the spend limits outside the process (Roy's direction, 2026-09-22). (2) The BRI-206 guard records the cost the provider reports. Claude returns tokens, not dollars, so any cost Atlas computed would be tokens times a price table of unverified figures. Atlas therefore computes no cost at all, and the gateway's own estimate is what its limits act on. (3) The BRI-206 client never retries a failed call, while this ticket asks for a corrective retry. They are different things (a retry after a failed request versus a second attempt after a failed check), and both are kept, but the difference is deliberate. (4) `docs/02` section 12 lists cancellation policy as grounding input, which conflicts with the confirmed BRI-204 permission, so cancellation policy is excluded from the prompt and from the hash. (5) `docs/08` line 24 ("a price...") and line 27 ("Roy has firsthand knowledge") describe copy that tour fields cannot support, and its calibration example states facts outside any tour field. None of the three is carried into the prompt. (6) There is no `ai_summary` column and no LLM dependency in the codebase yet, so this is the first real LLM integration. (7) `docs/scope/` had no BRI-154 row when this was designed, so the feature was enrolled as row 8 of `docs/scope/_root/scope.md` on acceptance. (8) The brief's "reuse the BRI-206 spend guard pattern" is only partly followed: its intent (a dry run by default and a hard maximum per run) is kept through the CLI dry run, the tour count cap, and the gateway and console limits, but the guard code is not reused. This changes what Roy confirmed in the earlier design round (a 5 USD run cap and a 30 USD lifetime budget enforced in code), and the section "The cost ceiling, re evaluated" below says exactly what changed and why. (9) Because the dry run has no price table, it prints a token estimate and no dollar figure, which is a step back from the BRI-206 dry run that printed one. (10) The model id is an optional environment variable, `TOUR_COPY_MODEL`, defaulting to `claude-sonnet-5`, so Haiku versus Sonnet can be revisited once BRI-201 has pass and fail data without a code change. A first draft had it as an env var allowlisted by the price table. The cleanup that dropped the price table also collapsed it to a code constant, and it was restored on review because that removed the reason for having it. The CLI checks it at startup against a short allowlist of intended models. That takes over the price table's allowlisting role (it stops a typo or an unintended model), but it does not prove the gateway prices the model, so calibration stays a separate gate.

Atlas imports about 30,157 live Viator tours into Postgres. Each has provider written text: a title, a description that averages about 660 characters, and inclusions and exclusions lists. That text is often thin, uneven, or written for the operator rather than the visitor. The content engine (BRI-120, EP-15) will replace hand written content with generated content, and per tour copy is the first generated content type. Later types (guides, collections, hub pages) will inherit whatever pattern this feature sets for prompts, checks, and spend control.

Several forces shape it. Nobody reviews individual pieces of copy (decision F1, 2026-09-20), so quality has to come from the engine: an eligibility gate that decides whether copy is generated at all (BRI-200, already merged), a prompt built from the voice guide, and a check on the output. Viator has confirmed (BRI-204) that AI copy is allowed only when it is grounded strictly in standard product fields, and that price, availability, and cancellation terms are shown live and unmodified, never generated or paraphrased. That is a contractual limit, so a violation costs more than a bad sentence. The work also spends real money on each call, and the only existing guard was built for a local research tool. Roy has a Cloudflare relationship already (R2 holds the raw import archive), and Cloudflare AI Gateway offers cost analytics and limits in front of the model provider, so the question is how much of the guard Atlas still needs to own.

The data is stored per tour and must go stale correctly. Ratings drift with every nightly import, and the provider edits descriptions, so the copy has to be tied to the exact source text it was written from, and it has to stop being served when that text changes or when the tour stops meeting the eligibility floor. Not deciding leaves the site with thin provider text everywhere and leaves each later generation type to invent its own cost control and its own safety check.

## Options considered

### Option 1: Store one row per tour, generated by a separate CLI job through Cloudflare AI Gateway, checked inline, validated by hash at read time

A new `TourCopy` table holds the paragraph, the grounding hash, and provenance. A CLI selects eligible tours, calls the model through a Cloudflare AI Gateway, runs a deterministic check with one corrective retry, and writes the row. The API read path recomputes the hash and the eligibility at request time and serves `aiSummary` only when both still hold. Dollar limits and rate limits live in the gateway configuration, and a tour count cap lives in the CLI.

**Pros**:
- Generation cost is paid once per change, not per page view, and is capped and observable.
- Stale or ineligible copy is never served, with no extra invalidation job.
- The importer is untouched, and provider text stays the fallback everywhere.
- Much less code than owning a guard, a price table, and a ledger. Cost analytics come free.
- The port, check, and hash pattern is reusable by BRI-152 and BRI-205, and the gateway is shared across them.

**Cons**:
- One new table and a new dependency, plus a Cloudflare resource to configure.
- Dollar limits are enforced outside the repo, are eventually consistent, and depend on Cloudflare pricing the model (see below).
- The read path does a small amount of extra work per experience.
- Generation is a manual step until the cron is wired.

### Option 2: Generate at request time and cache

The API calls the model the first time a tour is viewed, then caches the result in Redis or the database.

**Pros**:
- No backfill job and no batch scheduling.
- Only viewed tours cost anything.

**Cons**:
- A model call sits on the request path: latency, timeouts, and provider outages become page failures.
- Cost is driven by traffic and by crawlers, not by a budget, so any spend limit is much harder to make strict.
- The first visitor to a tour would see uncached or missing copy.

### Option 3: Add an `ai_summary` column to `Tour`, written by the importer

Generate inside the nightly import and store the text as a column on `Tour`.

**Pros**:
- No new table and no join.
- Copy is regenerated in the same place the source changes.

**Cons**:
- It couples a paid, slow, fallible call to the import pipeline, whose memory and time profile was carefully bounded (BRI-176).
- The importer would own a column whose lifecycle it does not control, breaking the provider owned versus Atlas owned boundary that the normalizer keeps.
- Provenance (model, prompt version, hash, failure reasons) has no natural home on `Tour`.

### Option 4: Use the Batch API for the backfill and the nightly job

Submit tours as batch jobs and collect the results.

**Pros**:
- Batch pricing is lower per token.
- Suits a large one time backfill.

**Cons**:
- Adds asynchronous state (submitted, pending, collected) to a job whose steady state is a handful of tours a night.
- The savings on an estimated 18 USD backfill are a few dollars.
- A corrective retry becomes a second batch, which is awkward.
- It is not confirmed that the gateway supports batch calls, so limits and logs might not apply.

## Rationale

Option 1 is the only one that keeps the paid call off the request path, off the importer, and behind a spend limit at the same time. Option 2 fails the cost control force: a crawler or a traffic spike would set the bill. Option 3 fails the ownership force: the importer's whole design is that it writes provider owned fields only and runs in bounded memory, and a paid model call with its own failure modes does not belong in it. Option 4 is a reasonable optimization but adds state for savings that do not justify it at the current size, and it can be added behind the same port later if the catalogue grows.

The hash at read time answers the staleness force with the least machinery. A stored `stale` flag would need the importer to set it, which puts a write to `TourCopy` in the importer. A recomputed hash is a pure function that both the CLI and the read path share, so the two can never disagree about whether a row is current. The same reasoning applies to eligibility: the gate already exists as a pure function, so the read path calls it instead of copying its result into a column.

The blocking check exists because of the contractual force. Prompt instructions reduce the chance of price or cancellation language but cannot guarantee it, and there is no human to catch it. A deterministic check is cheap, testable, and does not add a second paid call. It is a heuristic, so it is deliberately kept small and its rejections are counted. BRI-201 will absorb it and add the sampled evaluation. Voice patterns (em dashes, the contrastive reveal, clichés) are logged as counters and not blocked, because blocking on style would spend retries on sentences that are still grounded and safe, and BRI-201 exists to judge style in aggregate.

### Why the gateway, and what it replaces

Routing through Cloudflare AI Gateway keeps the same `@anthropic-ai/sdk` and the same adapter shape, and changes only the base URL and the credential. In return Atlas no longer needs a price table (the gateway prices calls), a spend guard (the gateway enforces budgets), or a spend ledger (the gateway logs every call with its tokens, cost, and metadata). The one thing the gateway cannot know is which grounding hash triggered which call, so that link travels as request metadata and is stored on the `TourCopy` row. That is all the provenance the earlier `LlmSpendLedger` table was needed for, so the table is dropped. A per call table of our own would duplicate the gateway logs and add a second thing to keep consistent.

The credential choice is bring your own key: the Anthropic key is stored in the gateway, and Atlas holds only a gateway token. That leaves one fewer copy of the Anthropic key in Doppler and Railway, and it sidesteps the Unified Billing limit of 200 requests per 60 seconds (which does not apply to bring your own key). The trade is that the gateway becomes the single place the provider key lives, so losing gateway access loses generation, but not page serving.

### The cost ceiling, re evaluated

The earlier design round confirmed a 5 USD run cap (hard maximum 5), a 25 USD month ceiling, and a 30 USD total budget, all enforced in code by a ported guard. Roy asked for that to be re evaluated against what the gateway can actually do. This is what was checked (Cloudflare documentation, 2026-09-22) and what it changed.

| Control from the earlier design | What the gateway offers | Result |
|---|---|---|
| Run cap, 5 USD | Spend limits are cost based budgets scoped by model, provider, or a metadata value, with a "split by value" mode that gives each distinct value its own bucket. A rule split by `run_id` is a per run budget. | Partly covered. It catches one runaway run, but every run has a fresh `run_id` and so a fresh bucket, so it is a speed bump and not a cap. The window must also be at least a day, and enforcement is eventually consistent |
| Month ceiling, 25 USD | A gateway wide spend limit with a monthly window | Covered, and raised to 40 USD so an 18 USD backfill with retries and calibration fits with margin |
| Total budget, 30 USD lifetime | Windows are daily, weekly, or monthly only. No lifetime window is documented. | Not covered. The monthly rule is the longest cap. A backfill of about 18 USD fits inside a month, so it is bounded, but the number 30 no longer exists as a rule |
| Fail closed before a call | A 429 once a limit is exceeded | Covered, but after the fact: cost is recorded when a call completes, so concurrent calls can briefly pass the limit |
| Refuse when the estimate would pass the cap | No estimate step. It only blocks after usage is recorded. | Not covered. With 4 workers the overshoot is a few calls, which is cents against a 5 USD rule |
| Dry run default and plan | Not a gateway feature | Kept in the CLI. It prints counts and a token estimate, and no dollar figure, because Atlas has no price table |
| Price table as endpoint allowlist | Not applicable | Replaced by host validation on the base URL and a startup check of the model id against a short allowlist of intended models. The list stops a typo or an unintended model. It does not prove the gateway prices the model, which only calibration shows |
| Request rate control | Rate limiting counts requests per window over the whole gateway, not cost | Used only as a burn rate backstop that needs no pricing knowledge |

Four findings shaped the result:

1. **Rate limiting is not a cost control.** It counts requests. A fixed count of requests can cost very different amounts depending on the model and the text, so it cannot stand in for a budget. It is kept as a backstop at 300 requests per 60 seconds (about 5 a second, well above 4 workers), and its value is that it bounds burn without depending on anything being priced correctly.
2. **Spend limits are real and cover most of the design**, but they are a newer feature (the changelog is dated 2026-06-05), they are eventually consistent by Cloudflare's own description, and they apply to "models with known pricing". Cloudflare does not say what happens for a model it cannot price, and does not confirm that Sonnet 5 is priced or how prompt cache tokens are counted. If Sonnet 5 is unpriced, a limit could count zero and never trigger. This is the largest risk in the whole design, and it is invisible from code. So the spec makes a real call showing a nonzero cost, and a throwaway limit returning 429, an explicit calibration step that gates the backfill.
3. **A count cap in code is still worth having** because it needs neither pricing nor the gateway. `TOUR_COPY_MAX_TOURS` (default 2,500, about 5 USD at the estimate) bounds a run by number of tours, so even if every gateway control failed silently, one run cannot exceed roughly 5 USD at today's per tour cost. It is a count limit, not cost logic, and it is a few lines. It bounds one run, not the total, because nothing stops Roy from starting another run. That is why finding 4 matters as well. This is the single piece of enforcement that stays in Atlas, and it is a deliberate backstop against finding 2, not a return to the ported guard.
4. **The Anthropic console is the second independent ceiling and the source of truth for real spend.** Cloudflare's figure is an estimate, and its limits may not fire at all if Sonnet 5 is unpriced there. A monthly limit in the Anthropic console (50 USD) does not depend on Cloudflare in any way. It sits above the gateway's 40 USD rule so the gateway trips first in normal operation and the console only matters if the gateway has failed. Together with the count cap this gives three ceilings (tour count, gateway monthly, console monthly) that fail for different reasons.
5. **A 429 from the gateway can mean either a rate limit or a spend limit, and the SDK retries a 429 twice before it surfaces.** The CLI therefore ends the run after the retries are used up, prints the raw status text and every `cf-aig-` response header, and does not try to decide which kind it was. Calibration is where Roy learns whether the two can be told apart, and if they can, a later change can teach the CLI to say so.

What you lose compared with the earlier round: the exact 30 USD lifetime total, strict no overshoot enforcement, a true per run cap (the per run rule is only a speed bump), a dollar figure in the dry run, and the ability to see spend inside Atlas itself. What you gain: no ledger table, no guard class, no price table, and no second migration to write and maintain, one cost view shared with future generation types, and one place to change limits without a deploy. If you later want a hard lifetime total back in code, the smallest way is to count `TourCopy` rows already written and refuse a run past a set number, not a return to the ledger.

### Reviewer suggestions considered and not adopted

The cross check by another model raised two suggestions that this spec deliberately does not take.

- **A `TourCopyRun` table** (run id, start and end, counts, token totals, exit reason). It would give a durable run history that the gateway logs cannot promise, because those logs delete the oldest entries at the limit. It was left out because the `runId` on each `TourCopy` row already gives durable published and failed counts per run, the gateway dashboard filtered by `run_id` gives tokens and cost while the logs last, and Roy asked to shrink the tables, not add one. It stays listed as a follow up for when a durable history is wanted.
- **Dropping Cloudflare for version one** and calling Anthropic directly with a console limit. That would remove the largest unverified risk (Sonnet 5 pricing coverage in the gateway). It was not adopted because Roy directed the gateway explicitly, and because the design already makes the gateway an optional layer of protection: the count cap and the console limit hold whether or not the gateway prices the model, and calibration proves the gateway before any backfill.

Two other details are worth stating. Sonnet 5 is the default because the prompt is rule heavy and the cost difference to a smaller model is a few dollars over the whole backfill, and the model id is an environment variable checked against an allowlist, so Haiku versus Sonnet can be revisited once BRI-201 has data without a code change. Each row records its model, and moving the whole catalogue to a new model uses a prompt version bump with `--regenerate-older-than-version`. Thinking is disabled explicitly, because omitting it turns on adaptive thinking, whose output tokens are billed and would not be covered by any estimate or limit that assumes plain output.

Gateway caching is turned off for these calls (`cf-aig-skip-cache: true`) because the corrective retry must reach the model, and a cached failure would repeat. The gateway's own retries are left off because the SDK already retries (twice by default), and stacking the two would multiply calls and cost on a bad day.

## Evidence

Read only queries against the production Neon database (2026-09-22):

- 30,157 live tours (`deletedAt` is null).
- 8,855 are eligible under BRI-200 (rating at least 4.0 and at least 5 reviews). All 8,855 are linked to an Experience. 8,854 sit on published Experiences and 1 on a draft (one Tour per Experience).
- Average description length is 658 characters (about 165 tokens), the longest is 1,725. Inclusions plus exclusions average about 266 characters.
- Estimated cost is about 0.002 USD per tour, so about 18 USD for the full backfill on Sonnet 5 at 2 USD input and 10 USD output per million tokens, with the new tokenizer's roughly 30 percent higher token count included. These prices come from the bundled Claude API reference and were not checked against the live pricing page. Using a smaller model or the Batch API would each roughly halve the figure. An earlier rough estimate of 45 to 90 USD in the design conversation was wrong, and this measured figure replaces it. The tour count cap of 2,500 is derived from this figure (2,500 times 0.002 is 5 USD).

Facts about the model API this design relies on (from the bundled Claude API reference, verified 2026-09-22):

- `claude-sonnet-5` has a 1M token context window and 128K maximum output.
- It rejects `temperature`, `top_p`, `top_k`, and `budget_tokens`.
- Omitting `thinking` runs adaptive thinking. `thinking: {type: "disabled"}` is allowed only at effort `high` or lower.
- The prompt cache minimum is 1024 tokens. Reads cost about 0.1 times the input price and 5 minute writes about 1.25 times. The usage fields are `input_tokens` (the uncached remainder), `cache_creation_input_tokens`, and `cache_read_input_tokens`.
- `stop_reason: "refusal"` can occur and must be handled.
- The TypeScript SDK (`@anthropic-ai/sdk`) has typed errors and retries connection errors, 429, and 5xx by default (2 retries).

Facts about Cloudflare AI Gateway this design relies on (from Cloudflare's developer documentation, read 2026-09-22, not yet proven against a real gateway):

- The Anthropic base URL is `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic`, and the SDK accepts it as `baseURL`.
- An authenticated gateway takes `cf-aig-authorization: Bearer <token>`. With a stored provider key (bring your own key), the SDK still needs a placeholder `apiKey`, and the real `x-api-key` must not be sent. The documentation shows more than one header form, so the builder confirms the exact form.
- Spend limits: cost based, scoped by model, provider, or custom metadata, with modes "partition" (an independent budget per distinct value) and "filter" (applies only when a value matches). Windows are daily, weekly, or monthly, fixed or rolling. At most 20 rules per gateway. A 429 is returned when exceeded. Cost is recorded after completion, so concurrent requests can briefly exceed a limit.
- Rate limiting counts requests in fixed or rolling windows across the gateway and returns 429. It has no cost or token limit and no per key scope.
- Per request metadata (`cf-aig-metadata`): a JSON object of strings, numbers, or booleans, at most 5 entries, attached to log entries and usable for spend limit scoping.
- Logs: 10 million per gateway on paid plans and 100 thousand per account on free. When the limit is reached the gateway either deletes the oldest or stops saving new ones. `cf-aig-collect-log-payload: false` logs metadata without request and response bodies.
- Per request controls exist for retries (`cf-aig-max-attempts`), caching (`cf-aig-skip-cache`, `cf-aig-cache-ttl`), and timeouts (`cf-aig-request-timeout`).
- Cost tracking is an estimate. It needs the response to return token data and a model name. The documentation does not say whether `claude-sonnet-5` has known pricing, how cache read and write tokens are priced, what a spend limit does for an unpriced model, or what the body of a 429 looks like. Each of those is unverified and is why calibration comes before the backfill.

BRI-206 spend guard pattern (for reference, not reused as code): `SpendGuard` with `check`, `plan`, and `record`, integer micro dollar math, run cap default 1 and hard maximum 5, month ceiling 25, total budget, fail closed on a corrupt ledger, and the dry run default with `--execute`. Its dry run default and its hard maximum spirit carry over. Its ledger, price table, and guard class do not.
