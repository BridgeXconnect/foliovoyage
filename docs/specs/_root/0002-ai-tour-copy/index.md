# 0002. AI generated tour copy (`ai_summary`)

**Date**: 2026-09-22
**Status**: In Progress

## Summary

Atlas will write a short paragraph for each eligible tour with a language model, using only the standard Viator product fields for that tour. The copy is stored in its own table and served as a new `aiSummary` field next to the untouched provider description. A separate command line job generates it, with a dry run by default. Every model call goes through a Cloudflare AI Gateway, which holds the dollar and rate limits, so Atlas keeps no cost logic or spend table of its own, only a cap on how many tours one run may generate. A blocking check rejects anything that mentions price, cancellation, or facts the tour data does not contain, and nobody reviews individual paragraphs, so the eligibility gate, that check, and the limits are the quality and cost control.

## Requirements

**User stories**:
- As a visitor reading a destination page, I want a short, specific summary of each good tour so that I can decide quickly what it is.
- As Roy, I want generation to cost a known, capped amount and to be safe to rerun so that a backfill never surprises me with a bill or duplicate work.
- As the owner of the Viator relationship, I want copy grounded only in standard product fields and never in price, availability, or cancellation terms so that Atlas stays inside the confirmed permission (BRI-204).
- As the engineer building BRI-201, I want every generated paragraph to carry its model, prompt version, grounding hash, and run id so that I can sample and evaluate it later without changing this feature.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: Generation runs only for a tour where `evaluateTourCopyEligibility` returns `eligible === true`, `deletedAt` is null, its Experience has `status = "published"`, and the combined length of its title, description, inclusions text, and exclusions text is at least `MIN_SOURCE_CHARS` (300). A tour that fails the length rule is skipped with reason `source_too_thin`. Any tour that fails any rule gets no `TourCopy` row and no model call.
- **AC-2**: The request body built for a tour contains only that tour's title, description, `durationMin`, inclusions, and exclusions, plus the fixed system rules. It never contains rating, review count, price, currency, cancellation policy, tags, coordinates, or the city name. The system rules ask for English, state every limit in AC-5 (2 to 4 sentences, 30 to 100 words, no number that is not in the source, no price, cancellation, refund, or availability language), and do not carry the `docs/08` line 24 text, the line 27 text, or the calibration example. A test asserts the rule text contains the same numbers as the check's constants, so the two cannot drift apart.
- **AC-3**: The grounding hash is a pure function of exactly the five fields in AC-2. Its output is the string `v1:` followed by a sha256 hex digest. The digest covers each field as a length prefixed segment (`<length>:<value>`, with a distinct sentinel for null so null and an empty string differ), text normalized to NFC, and inclusions and exclusions serialized with recursive key sorting and array order kept. Changing any one of the five fields changes the hash. Changing rating, review count, price, currency, cancellation policy, images, or tags does not. Key order inside objects does not change it. A unit test pins one fixture input to its literal hash string, so any change to the algorithm fails CI. A stored hash whose prefix is not the current version counts as not current.
- **AC-4**: A successful generation stores one `TourCopy` row per tour with `status = published`, `aiSummary`, `groundingHash`, `model`, `promptVersion`, `generatedAt`, `attempts`, `failureReasons`, and `runId`. Regenerating overwrites that row and never adds a second one.
- **AC-5**: The inline check blocks a paragraph, with these closed reason codes, when: (a) `price_language`: it contains a currency symbol or code, or a word from the price list; (b) `cancellation_language`: it contains a word or phrase from the cancellation, refund, and availability list; (c) `unsourced_number`: it contains a digit run that is not allowed (see the check details), or a month name or four digit year that is not in the source fields; (d) `sentence_count` or `word_count`: it is outside 2 to 4 sentences or outside 30 to 100 words; (e) `low_overlap`: it shares fewer than 8 distinct content words with the source fields. The other codes in the closed set are `refusal` and `source_too_thin`. A blocked paragraph is never stored as `aiSummary`.
- **AC-6**: On a check failure the service makes exactly one corrective retry, sent as a second user turn holding one fixed sentence per reason code that names the violation. If the retry also fails, the row is stored with `status = failed`, `aiSummary = null`, `attempts = 2`, and the reason codes in `failureReasons`. Provider text keeps being served for that tour. If the retry passes, the row is `published` and `failureReasons` keeps the codes from the first attempt.
- **AC-7**: A later run skips a tour whose row is `published` and whose `groundingHash` equals the current hash. It skips a `failed` row unless the current hash differs from the row's, the row's `promptVersion` differs from the current one, or `--retry-failed` is passed. A `published` row is regenerated for an older version only when `--regenerate-older-than-version N` is passed, meaning its `promptVersion` is below N (the first version is 1). The flags are independent of each other, and none of them implies `--execute`.
- **AC-8**: The CLI defaults to a dry run. Without `--execute` it makes no model call and writes no row, and it prints how many tours it would generate, how many it would skip by reason, and an estimated token count at 3.1 characters per token. It prints no dollar figure.
- **AC-9**: Every model call goes to the Cloudflare AI Gateway and nowhere else: a base URL on any other host fails config validation and nothing is sent. A run generates at most `min(--limit, TOUR_COPY_MAX_TOURS)` tours (default cap 2,500). A `--limit` above the cap is reduced to the cap and the CLI prints that it did so. If the gateway answers 429 after the SDK's own retries, the run ends at once, prints the raw status text and every `cf-aig-` response header, and points at the gateway limits. The CLI does not decide which kind of 429 it was. No row changes for the tour that hit it.
- **AC-10**: Every model call carries the request metadata `run_id`, `tour_id`, `grounding_hash`, `content_type` (the value `tour_copy`), and `attempt` (the gateway allows 5 entries), so the gateway log for any call names the tour and hash that triggered it and later generation types can be told apart. Atlas computes and stores no cost and keeps no spend table.
- **AC-11**: The model id comes from the optional env var `TOUR_COPY_MODEL`, default `claude-sonnet-5`, and must be on the code constant `TOUR_COPY_ALLOWED_MODELS` (starting with `claude-sonnet-5` and `claude-haiku-4-5`). A value off the list, including a typo, fails at CLI startup with a message that names the allowed ids (AC-19), before any database access or model call. Being on the list means the model is one we intend to use. It does not mean the gateway prices it, and it does not stand in for calibration (build step 9), which must show a nonzero gateway cost for the model in use before that model's first backfill. Every request sends the configured id, and the same id is stored in `TourCopy.model` (AC-4). Tests assert each of those.
- **AC-12**: `GET /v1/destinations/:country/:city` returns `aiSummary` for an experience as a string only when the `TourCopy` of its first tour (ordered by `id` ascending) is `published`, its `groundingHash` equals a hash recomputed from that tour's current fields, and `evaluateTourCopyEligibility` is still `eligible`. In every other case it returns `null`. The existing `description`, price, and other fields are unchanged.
- **AC-13**: Every request sets `thinking` to disabled, `max_tokens` to 400, and an SDK request timeout of 60 seconds. It sends no `temperature`, `top_p`, `top_k`, or `budget_tokens`, defines no tools, sets `cf-aig-skip-cache: true`, leaves the gateway's own retry headers unset, and wraps the provider text in delimited data blocks. A `stop_reason` of `refusal` is stored as a failed row with `attempts = 1` and `failureReasons = ["refusal"]`, and is not retried.
- **AC-14**: A transient API error that survives the SDK's own retries skips that tour for the run and changes no row. Five consecutive such errors abort the run with a clear message. A surviving 429 is handled by AC-9, not counted here.
- **AC-15**: Each run prints a summary with the run id (to filter the gateway dashboard), the last `Tour.id` reached, counts by outcome (generated, skipped by reason, failed by reason, API errors), token totals including cache reads, and three counters for the non blocking voice patterns from `docs/08`. Per tour reason codes are stored in `failureReasons`.
- **AC-16**: The importer never writes to `TourCopy`. Re importing a tour (any field change, or none) leaves its `TourCopy` row in place.
- **AC-17**: No more than `TOUR_COPY_CONCURRENCY` (default 4) model calls are in flight at once, and no tour is generated twice in one run.
- **AC-18**: A run walks candidate tours in ascending `Tour.id` order, applies every skip rule (AC-1, AC-7) first, and stops once it has generated its allowed number of tours (AC-9), so a rerun resumes where the last one stopped. The database query that picks candidates builds its rating and review count filters from the exported `MIN_RATING` and `MIN_REVIEW_COUNT` constants, and the pure gate is run again in code before every call. A test asserts the query filter and the pure gate agree on a set of edge tours.
- **AC-19**: The CLI validates `AI_GATEWAY_BASE_URL` and `AI_GATEWAY_TOKEN`, and `TOUR_COPY_MODEL` when it is set, at startup. It exits non zero with a named message before it touches the database if either gateway variable is missing or invalid, or if the model id is not on the allowlist (AC-11).

## Decision

**Chosen option**: Option 1: Store one generated row per tour, produced by a separate CLI job that calls the model through Cloudflare AI Gateway, validated by a blocking check, and trusted at read time only if its grounding hash still matches.

The decisions inside that option, with the pick, the reason, and the runner up:

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Copy shape | One paragraph, 2 to 4 sentences | Matches the `docs/08` rule and is easy to check mechanically | Two fields (a headline plus a body) |
| Scope edge | Generate, store, and expose on the API. Rendering on web is a separate story | Keeps this story to one app and lets the backfill run before any visible change | Include the web render |
| Inline check | Blocking, deterministic, no second model call | BRI-201 does not exist yet and the BRI-204 permission needs a hard stop now | Log only, no block |
| Thin source text | Skip tours whose combined source text is under 300 characters | The gate checks only rating and review count, so a title only tour would otherwise get invented copy | Generate anyway and rely on the check |
| Retry | One corrective retry, then fall back to provider text | Bounds cost per tour and keeps the page complete | Retry until it passes |
| Provider shape | A narrow `TourCopyGenerator` port with one Anthropic adapter on `@anthropic-ai/sdk`, injected by DI token | Tests use a fake, and later generation types reuse the pattern | Call the SDK directly in the service |
| Route | The adapter's SDK client points at a Cloudflare AI Gateway (`baseURL` ending in `/anthropic`), and only that host is accepted | Roy's direction: the gateway carries cost analytics and limits, and the SDK and adapter shape stay the same | Call `api.anthropic.com` directly with a console spend limit |
| Cost control | Three ceilings that do not depend on each other: a tour count cap in code, a gateway wide monthly spend limit, and an Anthropic console limit. A per run gateway spend rule and a gateway rate limit sit on top as speed bumps. No price table, no guard, no ledger in Atlas | See the note below the table on what each control can and cannot do | Keep the Postgres ledger and guard in Atlas |
| Provenance | Request metadata on every call (in the gateway logs) plus `runId`, hash, model, prompt version, and failure reasons on `TourCopy`. No spend table and no run table | The hash to call link is already in the gateway logs, and the hash to output link is already on the row | A small per call table, or a `TourCopyRun` table |
| Credential | Store the Anthropic key in the gateway (bring your own key) and let the API hold only a gateway token | One fewer copy of the Anthropic key, and it avoids the Unified Billing rate limit of 200 requests per 60 seconds | Send our own `x-api-key` from Doppler |
| Model | `claude-sonnet-5` by default, from the optional `TOUR_COPY_MODEL` env var, checked at CLI startup against a short allowlist constant of intended models | Strong instruction following for a rule heavy prompt at about 0.002 USD per tour. Swapping between allowlisted models needs no code change, so Haiku versus Sonnet can be revisited once BRI-201 has pass and fail data. The allowlist catches a typo before any call, and every row records its `model` | A code constant only, or any model id accepted unchecked |
| Job design | Separate CLI, synchronous calls, 4 workers | Steady state is a handful of tours a night, so the Batch API adds machinery for no gain | Batch API |
| Selection | Ascending `Tour.id`, skip rules applied before the run limit | A backfill is resumable and reproducible | Random or newest first |
| Trigger | CLI only. Roy runs the first backfill. The Railway cron is wired later as its own approved step | No deploy without Roy's go ahead, and BRI-201 does not exist yet | Wire the cron now |
| Grounding hash | title, description, `durationMin`, inclusions, exclusions, versioned `v1:` | Excludes rating (which drifts) and cancellation policy (BRI-204) | Reuse `Tour.source_hash` |
| Stale copy | Read path recomputes the hash and serves `aiSummary` only on a match | A pure function, no extra column, no window where stale text is live | Clear `aiSummary` from the importer |
| Ineligible later | Read path re evaluates eligibility and serves provider text if it fails | The gate stays the single source of truth | Delete the row |
| Prompt version bump | Nothing automatic, explicit regeneration flag through the same dry run and limits | A prompt edit must never trigger a surprise spend | Auto regenerate |
| Output format | Plain text, no JSON schema | One paragraph needs no structure, and fewer format failures | Structured output |
| Concurrency | 4 workers | Fast enough, and gentle on rate limits | 1 worker |
| Abort rule | Stop after 5 consecutive API errors, and at once on a 429 that survives the SDK's retries | Prevents a spend loop during an outage or after a limit is hit | Never abort |
| Prompt injection | Provider text wrapped as delimited data, no tools, plain text output, check as backstop | The source is untrusted third party text | Trust the model |
| Thinking | Disabled, with `max_tokens` 400 (headroom for the new tokenizer, about 30 percent more tokens than Sonnet 4.6) | Omitting it turns on hidden adaptive thinking, an unbudgeted output cost | Adaptive |
| Sampling params | None sent | Sonnet 5 rejects them, so the retry changes the prompt only | Vary temperature on retry |
| Module layout | Pure functions in `modules/content`, imported by the CLI and by `DestinationService` | Both must compute the same hash and the same eligibility | Duplicate in each |

**What the cost controls can and cannot do** (checked against Cloudflare's docs on 2026-09-22, and the reason the design is not simply "the gateway handles cost"):
- **Rate limiting counts requests, not dollars.** It cannot cap spend by itself. It is kept only as a burn rate backstop that does not depend on pricing: 300 requests per 60 seconds allows the expected 4 workers with room.
- **Spend limits are the dollar control.** They are cost based budgets scoped by model, provider, or a metadata value ("split by value" gives each distinct value its own bucket), with a fixed or rolling window and a 429 when exceeded.
- **A per run spend rule is a speed bump, not a cap.** Each run has a fresh `run_id`, so a run that hits its limit is followed by a new run with a fresh bucket. It still catches a single runaway run, but the real ceilings are the tour count cap, the gateway wide monthly rule, and the Anthropic console limit.
- **Spend limits are eventually consistent.** The current request's cost is recorded after it completes, so concurrent requests can briefly pass a limit. With 4 workers the overshoot is a handful of calls (cents).
- **They only apply to models with known pricing, and cost is an estimate.** Cloudflare's docs do not say what happens for a model it has no price for, and do not confirm Sonnet 5 is priced or how cache tokens are priced. If Sonnet 5 is unpriced the gateway limits may silently never trigger, so calibration must prove a nonzero cost on a real call before any backfill, and use a request level custom cost if needed. The same holds for any other model swapped in later: the model allowlist only says a model is intended, not that the gateway prices it, so calibration is repeated before that model's first backfill. The count cap and the Anthropic console limit do not depend on this.
- **There is no documented lifetime total.** The 30 USD total from the design conversation cannot be expressed. The gateway wide monthly rule replaces it.
- **A 429 can mean a rate limit or a spend limit, and the SDK retries 429 twice by default.** So "the run ends at once" means after three tries, and the CLI logs the raw status and headers so calibration can tell the two apart.
- **The limits live in Cloudflare configuration, not in this repo.** So the spec lists them under Configuration and makes verifying them a calibration step, since code cannot enforce what code does not own.

## Feature design

**Data model sketch**:

`TourCopy` (new, one row per tour, the only new table):

| Field | Type | Rules |
|---|---|---|
| `id` | text, cuid | primary key |
| `tourId` | text | foreign key to `Tour.id`, unique, `onDelete: Cascade` |
| `status` | enum `TourCopyStatus` (`published`, `failed`) | required |
| `aiSummary` | text | null when `failed`, required when `published` |
| `groundingHash` | text | required, `v1:` plus a sha256 hex digest of the five source fields |
| `model` | text | required, the model that produced the row |
| `promptVersion` | int | required, from the code constant `TOUR_COPY_PROMPT_VERSION` (starts at 1) |
| `generatedAt` | timestamptz | required |
| `attempts` | int | 1 or 2 |
| `failureReasons` | text[] | codes from the closed set in AC-5, empty when the first attempt passed |
| `runId` | text | required, the run that wrote the row, also sent to the gateway as `run_id` |
| `createdAt`, `updatedAt` | timestamptz | required |

Relation: `Tour.tourCopy TourCopy?` (one to one). One migration creates the table and the enum. No column is added to `Tour`, and the importer's upsert code does not change. There is no ledger table and no run table: per call token counts and cost live in the gateway's logs and analytics, each log entry carries the metadata that links it to a tour, a hash, and a run, and the row's `runId` gives durable published and failed counts per run.

**State transitions**:
- No row to `published`: first generation passes the check on attempt 1 or 2.
- No row to `failed`: both attempts fail the check, or the model refuses.
- `failed` to `published`: a later run after the hash changed, the prompt version changed, or `--retry-failed`.
- `published` to `published`: regeneration after a hash change or `--regenerate-older-than-version N`. The row is overwritten.
- A `published` row whose hash no longer matches, or whose tour is no longer eligible, stays in the table and is simply not served.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/v1/destinations/:country/:city` | GET | `country`, `city` (path), existing query params | existing `ExperienceResponse` plus `aiSummary: string \| null` on each experience | public (unchanged) | 404 unknown city (unchanged) |
| `pnpm --filter @folio/api tour-copy:run` (CLI) | command | `--execute`, `--limit N`, `--retry-failed`, `--regenerate-older-than-version N` | run summary on stdout, rows in `TourCopy`, call logs in the gateway | needs `AI_GATEWAY_BASE_URL`, `AI_GATEWAY_TOKEN`, and `DATABASE_URL` from Doppler | exits non zero on a config error, a surviving 429, or 5 consecutive API errors |

`ExperienceResponse` in `apps/api/src/destinations/destination.types.ts` gains `aiSummary: string | null`. `description` is untouched. `DestinationService` widens its Tour select to `title`, `description`, `durationMin`, `inclusions`, `exclusions`, `ratingAvg`, `ratingCount`, adds `orderBy: { id: "asc" }` with `take: 1` so the served tour is deterministic, and joins `tourCopy` (`status`, `aiSummary`, `groundingHash`).

**Check details** (starting values, all code constants in `modules/content`, tuned during calibration and not invented by the builder):
- **Price words**: `price`, `prices`, `cost`, `costs`, `cheap`, `affordable`, `fee`, `fees`, `dollars`, `euros`, `pounds`, `baht`, `discount`, and any of the symbols `$ € £ ¥ ฿` or the codes `USD EUR GBP THB` as whole words. The word `free` is not on the list, because inclusions such as free hotel pickup are grounded.
- **Cancellation, refund, and availability words**: `cancel`, `cancels`, `cancelled`, `cancellation`, `refund`, `refunds`, `refundable`, `reschedule`, `available`, `availability`, `book now`, `sold out`, `spots left`, `seats left`.
- **Allowed digit runs**: every digit run found in the five source fields, plus the digit runs of `durationMin`, of `floor(durationMin / 60)`, of `durationMin % 60` when nonzero, and `5` when `durationMin % 60 = 30` (so "1.5 hours" passes). Spelled out numbers (such as "three") are not compared. That is a known gap, left to BRI-201.
- **Dates**: a month name or a four digit year in the output that is not in the source fields blocks as `unsourced_number`.
- **Sentence counting**: split on `.`, `!`, or `?` followed by whitespace and an uppercase letter, and a period between two digits never splits. Word counting splits on whitespace.
- **Content words for overlap**: lowercase, strip punctuation, drop a fixed list of about 100 English stopwords kept in code, keep tokens of 4 or more characters, and count distinct tokens present in both the paragraph and the source fields.
- **Voice counters (logged, never block)**: (1) em dashes, (2) the contrastive reveal and "come for X, stay for Y" patterns, each a named regex, (3) the cliché and stacked intensifier terms named in `docs/08` lines 16 and 17.
- **Corrective sentences**: one fixed sentence per reason code, stored next to the reason code enum (for example "Your last answer contained a number that is not in the tour data. Rewrite it using only facts from the tour data.").

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Select tours to generate | eligible or not | `evaluateTourCopyEligibility({ ratingAvg, ratingCount })` on `Tour.ratingAvg`, `Tour.ratingCount`, with the query filter built from `MIN_RATING` and `MIN_REVIEW_COUNT` |
| Select tours to generate | published Experience, not deleted | `Experience.status`, `Tour.deletedAt` |
| Select tours to generate | order | `Tour.id` ascending |
| Select tours to generate | how many per run | `--limit N`, clamped to `TOUR_COPY_MAX_TOURS`, counted after skip rules |
| Select tours to generate | thin source | title, description, inclusions text, and exclusions text length against `MIN_SOURCE_CHARS` (300) |
| Generate | grounding hash | derived from `Tour.title`, `description`, `durationMin`, `inclusions`, `exclusions` via the shared pure function |
| Generate | model | `TOUR_COPY_MODEL` (default `claude-sonnet-5`), validated against `TOUR_COPY_ALLOWED_MODELS`, stored as `TourCopy.model` |
| Generate | `max_tokens`, request timeout | code constants, 400 and 60 seconds |
| Generate | `promptVersion` | code constant `TOUR_COPY_PROMPT_VERSION` |
| Generate | run id | a uuid created once at CLI start, sent as `run_id`, stored as `TourCopy.runId` |
| Generate | gateway metadata (5 entries) | `run_id` (the run uuid), `tour_id` (`Tour.id`), `grounding_hash` (derived), `content_type` (the constant `tour_copy`), `attempt` (1 or 2) |
| Generate | gateway route and credential | `AI_GATEWAY_BASE_URL` (account and gateway id inside it), `AI_GATEWAY_TOKEN` sent as `cf-aig-authorization` |
| Generate | cost of a call | the gateway's analytics and logs, filtered by `run_id`. Atlas does not compute it |
| Generate | check thresholds and word lists | code constants listed under Check details |
| Retry | corrective message | the fixed sentence for each reason code |
| Dry run | estimated tokens | source text length divided by 3.1, plus the prompt length. No dollar figure |
| Run summary | token totals | the `usage` fields on each model response |
| Run summary | last tour reached | the highest `Tour.id` the run processed |
| Read path | which tour's copy | the first tour of the Experience ordered by `id` ascending |
| Read path | `aiSummary` | `TourCopy.aiSummary`, only if published, hash equal to a recomputed hash of that tour's current fields, and eligible now |
| Read path | eligibility now | `Tour.ratingAvg`, `Tour.ratingCount` at request time |

**Key invariants**:
- `aiSummary` reaches a client only through the read path rule in AC-12. Nothing else exposes it.
- A `failed` row always has `aiSummary = null`. A `published` row always has a non empty `aiSummary` that passed the check.
- Pricing, availability, and cancellation terms are never an input to the prompt and never in generated text. The check enforces the output side.
- No model call can reach a host other than the gateway, and every call carries the five metadata entries.
- Atlas never computes, stores, or enforces a dollar amount. The only limit Atlas enforces is a count of tours per run.
- A model id that is not on `TOUR_COPY_ALLOWED_MODELS` is never sent. Being on the list is not proof that the gateway prices the model. Only calibration shows that.
- The importer and `TourUpsertService` never read or write `TourCopy`.
- `TOUR_COPY_PROMPT_VERSION` changes whenever the system prompt text changes. The hash prefix changes whenever the hash algorithm changes.

**Implementation notes** (choices with no acceptance criterion, so the builder may adjust them):
- The system prompt follows the `docs/08` guidance to open on one specific, checkable fact from the tour data.
- The shared system prefix carries an explicit `cache_control` marker at its end. Measure the prefix first and do not pad it to reach the 1024 token minimum. If it is shorter, caching does nothing and that is fine.
- Run the first tour alone before starting the other workers, so the cache write happens once.

**Security model**:
- No new public endpoint. The one API change is an additive field on an existing public read.
- `AI_GATEWAY_TOKEN` lives only in Doppler, is read from the process environment, is never logged, and is redacted from any error text. The gateway is set to authenticated, so its URL alone is not enough to use it. The Anthropic key is stored in the gateway (bring your own key) and never reaches Atlas.
- Cloudflare sits in the request path and sees every prompt and response (the gateway's payload logging is left on so BRI-201 can inspect failed attempts). The content is provider marketing text, not personal data.
- Provider text is untrusted third party input. It is wrapped in delimited data blocks, the request defines no tools, the output is plain text, and the deterministic check is the backstop. Whoever renders `aiSummary` on the web must treat it as untrusted text and escape it.
- No personal data is processed. No compliance scope applies. The contractual limit is the BRI-204 permission, which the input rules and the check implement.

**Configuration required**:

In Atlas (Zod schema in `apps/api/src/config/env.validation.ts`, and `apps/api/.env.example`; all optional so the API boots without them, and the CLI re validates the two gateway variables and the model id at startup, AC-19):
- `AI_GATEWAY_BASE_URL`: the gateway URL for Anthropic, `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic`. Validation requires that host, so nothing else can be called.
- `AI_GATEWAY_TOKEN`: the Cloudflare token for the authenticated gateway, sent as `cf-aig-authorization: Bearer <token>`. The builder confirms the exact header and the placeholder `apiKey` handling against Cloudflare's Anthropic provider page, because the docs show more than one form.
- `TOUR_COPY_MODEL`: the model id, default `claude-sonnet-5`. It must be on `TOUR_COPY_ALLOWED_MODELS`. The Zod schema accepts any optional string, so a typo cannot stop the API from booting, and the CLI does the allowlist check at startup (AC-19).
- `TOUR_COPY_MAX_TOURS`: most tours one run may generate, default 2,500 (about 5 USD at the estimate). Must be a positive integer.
- `TOUR_COPY_CONCURRENCY`: workers, default 4.

Code constants in `modules/content` (not environment variables): `TOUR_COPY_ALLOWED_MODELS` (`claude-sonnet-5` and `claude-haiku-4-5`, where the builder confirms the exact Haiku id against Anthropic's model list), `TOUR_COPY_PROMPT_VERSION`, `MAX_TOKENS` (400), `REQUEST_TIMEOUT_MS` (60,000), `MIN_SOURCE_CHARS` (300), `CHARS_PER_TOKEN` (3.1), and the check word lists and thresholds.

In Cloudflare and Anthropic (set up by Roy, not code, and verified in calibration):
- A dedicated gateway for content generation (for example `folio-content`), authenticated on, with the Anthropic key stored as the gateway's key, request payload logging on, and the log strategy set to delete the oldest logs so it never stops recording.
- Rate limit: 300 requests per 60 seconds.
- Spend limit rule 1, per run speed bump: 5 USD, split by the `run_id` metadata value, with a window of at least one day.
- Spend limit rule 2, month ceiling: 40 USD across the whole gateway, the longest window the dashboard offers (a month). It is 40 and not 25 so an 18 USD backfill with retries and calibration fits with margin.
- Anthropic console: a monthly spend limit of 50 USD, set above the gateway rule so the gateway trips first and the console is the last resort. The provider dashboard stays the source of truth for what was actually charged.
- Prerequisite: a Cloudflare account with AI Gateway, and an Anthropic account with billing.

**Critical test scenarios** (each maps to an acceptance criterion in ## Requirements):
- Happy path: an eligible tour on a published Experience goes through the fake generator, passes the check, stores a `published` row, and the endpoint returns its `aiSummary`, verifies **AC-1**, **AC-4**, **AC-12**
- Thin source: an eligible tour with a title and 100 characters of other text is skipped with reason `source_too_thin`, no row, no call, verifies **AC-1**
- Request shape: the request body for a tour holds exactly the five fields and no price, rating, or cancellation text, the rule text contains the same numbers as the check constants, and the request has the fixed `max_tokens`, timeout, and `cf-aig-skip-cache`, and the configured model id, verifies **AC-2**, **AC-11**, **AC-13**
- Hash: changing `description` changes the hash and the endpoint then returns `null`. Changing `ratingAvg`, `priceMinor`, or `cancellationPolicy` leaves it unchanged. null and empty string differ. A pinned fixture input produces its literal `v1:` hash. A row with another prefix is not served, verifies **AC-3**, **AC-12**
- Check: one fixture each for a price phrase, a cancellation phrase, an invented number, an invented date, a one sentence answer, and a no overlap answer is blocked with the right reason code, verifies **AC-5**
- Check, duration: a paragraph saying "about 90 minutes" or "1.5 hours" for `durationMin = 90` passes, and "3 hours" fails, verifies **AC-5**
- Check, sentences: "2.5 hours" and "St. Paul's" do not add sentences, verifies **AC-5**
- Retry: first output fails, second passes, one row with `attempts = 2` and the first attempt's reasons kept, and the second request carries the fixed sentence for that code. Both fail, a `failed` row with reason codes and `aiSummary = null`, verifies **AC-6**, **AC-4**
- Skip rules: a matching `published` row is skipped. A `failed` row is skipped until the hash or prompt version changes or `--retry-failed` is passed. `--regenerate-older-than-version 2` regenerates a version 1 row and not a version 2 row. No flag implies `--execute`, verifies **AC-7**
- Dry run: no fake generator call, no rows written, a plan and a token estimate printed and no dollar figure, verifies **AC-8**
- Route and limits: a base URL on another host fails config validation. `--limit 5000` is reduced to the cap and says so. A fake 429 that survives retries ends the run at once, prints the raw status and `cf-aig-` headers, and changes no row, verifies **AC-9**, **AC-14**
- Metadata: every fake generator call receives the five metadata entries with the right values, verifies **AC-10**
- Refusal and errors: `stop_reason: "refusal"` stores a failed row with `attempts = 1` and no retry. A transient error changes no row. Five consecutive errors abort, verifies **AC-13**, **AC-14**
- Eligibility drift: a tour whose review count falls below 5 after generation returns `aiSummary: null` and its row remains, verifies **AC-12**
- Determinism: an Experience with two tours serves the copy of the lower id tour, verifies **AC-12**
- Importer independence: running the upsert on a tour with a `TourCopy` row leaves the row unchanged, verifies **AC-16**
- Concurrency: with 4 workers, no more than 4 calls are in flight and no tour is generated twice, verifies **AC-17**
- Selection: candidates are walked in `Tour.id` order, skipped tours do not count against the limit, a rerun resumes after the last generated tour, and the query filter and the pure gate agree on edge tours (rating 4.0 with 5 reviews, 3.9, 4 reviews), verifies **AC-18**
- Startup: a missing gateway variable exits non zero before any database call, verifies **AC-19**
- Summary: a run prints the run id, last tour reached, counts, tokens, and voice counters, verifies **AC-15**
- Model config: with `TOUR_COPY_MODEL` unset the request sends `claude-sonnet-5`. With `claude-haiku-4-5` set it sends that id and stores it in `TourCopy.model`. With an id off the allowlist, or a typo, the CLI exits non zero before touching the database and sends nothing, verifies **AC-11**, **AC-19**
- Gateway limits (manual, in calibration): a throwaway spend rule of 0.01 USD on a test run id makes the gateway answer 429 and the CLI stops, a real call for the model in use shows a nonzero cost in the gateway log, and the raw 429 headers show whether a rate limit and a spend limit can be told apart, verifies **AC-9**

## Build plan

The project approach is Tracer Bullet, so the order threads one tour end to end with a fake generator and no spend first, then thickens. No task sends a real model call until the gateway limits exist and are verified.

1. Create the migration for `TourCopy` and the `TourCopyStatus` enum, and add the Prisma model and the `Tour.tourCopy` relation, satisfies **AC-4**
2. Add the pure grounding hash function (versioned, length prefixed, NFC, sorted keys) and its input type in `modules/content`, with unit tests for field sensitivity, key order, null versus empty, and the pinned fixture, satisfies **AC-3**
3. Thin thread: add the `TourCopyGenerator` port and DI token, a `TourCopyService.generateOne` that applies the gate, the thin source rule, hash, and skip rule and writes a `published` row from a fake generator, and widen `DestinationService` (with `orderBy` and `take: 1`) and `ExperienceResponse` to serve `aiSummary` by the read rule. Cover it with an integration test on a real database, satisfies **AC-1**, **AC-4**, **AC-12**, **AC-16**
4. Add the prompt module (fixed system rules derived from `docs/08` that state the check's limits, delimited data blocks, the corrective sentences, `TOUR_COPY_PROMPT_VERSION`) and the deterministic check with its word lists, thresholds, closed reason codes, and the three voice counters, all pure and unit tested, satisfies **AC-2**, **AC-5**, **AC-13**, **AC-15**
5. Add the env vars to the Zod schema and `.env.example` (gateway host validation, model id, tour count cap, concurrency) and the code constants (model allowlist, max tokens, timeout, minimum source length), with the model allowlist check as a pure function the CLI calls at startup, satisfies **AC-9**, **AC-11**
6. Add `@anthropic-ai/sdk` and the Anthropic adapter pointed at the gateway: request shape, the five metadata entries, gateway auth header, cache marker, usage totals, refusal handling, error mapping with a stop on a surviving 429 that logs the raw status and headers, key redaction, satisfies **AC-9**, **AC-10**, **AC-13**, **AC-14**
7. Add the retry and failed row logic to `TourCopyService`, and the skip rules including `--retry-failed` and `--regenerate-older-than-version`, satisfies **AC-6**, **AC-7**
8. Add `tour-copy.cli.ts` and the `tour-copy:run` script: startup validation of the gateway variables and the model id, candidate query in id order with filters built from the gate constants, the run limit after skip rules, dry run default with the token estimate, `--execute`, `--limit` clamped to the cap, workers with the first tour alone, error abort, the run summary, satisfies **AC-8**, **AC-9**, **AC-14**, **AC-15**, **AC-17**, **AC-18**, **AC-19**
9. Cloudflare and Anthropic setup and calibration by Roy, no code: create the gateway, the rate limit, the two spend rules, and the console limit listed under Configuration, then confirm that a real call for the model in use shows a nonzero cost in the gateway log (if not, add a request level custom cost). The model allowlist only says a model is intended, so this proof is a separate gate, and it is repeated for any other allowlisted model before that model's first backfill. Then confirm a throwaway 0.01 USD rule on a test run id produces a 429 and the CLI stops, run `--limit 20 --execute`, read the outputs and the rejection reasons, count how many tours hit `source_too_thin`, tune the check if it over or under blocks, and compare the gateway's cost figure with the Anthropic console, satisfies **AC-5**, **AC-9**, **AC-10**
10. Backfill by Roy: four to five runs of `--execute`, watching the run summary and the gateway dashboard filtered by run id, satisfies **AC-9**, **AC-18**

## Consequences

**Positive**:
- Copy is grounded in permitted fields only, and the same rules apply to later generation types (BRI-152, BRI-205) through the same port and check pattern.
- Much less code to own: no price table, no spend guard, no ledger table, and no ledger migration. Cost analytics come from Cloudflare.
- Stale or ineligible copy stops being served at once with no extra job, because the read path recomputes the hash and the gate.
- Nothing visible changes until the web story renders `aiSummary`, so the backfill can be run and inspected first.
- Three ceilings (tour count, gateway monthly, Anthropic console) fail independently, so one of them being wrong does not remove all protection.

**Negative / tradeoffs**:
- The gateway dollar limits are enforced outside this repo, they are eventually consistent (a few calls can pass a limit), and they rely on Cloudflare knowing Sonnet 5's price. If it does not, they can silently fail to trigger. Calibration step 9 exists to prove otherwise, and nothing in code can check it on later runs. The tour count cap and the console limit are the backstops.
- The per run gateway rule is a speed bump, not a cap, because each run gets a fresh bucket.
- There is no lifetime total budget. The monthly rule is the longest cap available.
- The monthly gateway rule is shared by every generation type, so a later feature (BRI-152, BRI-205) can use up the budget this one needs.
- Atlas cannot show spend in its own database or its own run summary (tokens only). Cost lives in the gateway dashboard and the Anthropic console, and Cloudflare's figure is an estimate.
- There is no durable record of a run beyond the `runId` on each row. API errors and token totals live in stdout and in the gateway logs, and gateway logs are not durable (at the log limit they delete the oldest or stop saving). A `TourCopyRun` table was considered and left out to keep the schema small.
- Cloudflare is now a dependency of generation, so a gateway outage stops generation (page serving is unaffected) and Cloudflare sees every prompt.
- The check is a set of heuristics with starting values. It can over block (wasting a retry) or let a bland or slightly wrong sentence through, and no human reads individual paragraphs. It does not compare spelled out numbers. BRI-201's sample evaluation is the safety net, and it does not exist yet.
- A stricter check or a new prompt does not unpublish copy already stored. Only the regeneration flag applies it.
- The read path now does a hash and an eligibility evaluation per experience on every destination request (cheap, about 1 KB of hashing each, at most 48 per page), and joins one more table. A hash algorithm change would blank every `aiSummary` at once, which the pinned fixture test guards against.
- The backfill takes about four runs, and nightly generation stays a manual step until the cron is wired.
- The system prompt may be under the 1024 token cache minimum, in which case caching silently does nothing (an estimated few dollars over the whole backfill).

**Neutral**:
- New runtime dependency `@anthropic-ai/sdk`, and the first LLM call in the codebase. New Cloudflare AI Gateway resource.
- One new migration and one new table.
- The SDK retries connection errors, 429, and 5xx by itself (default 2). That is separate from the one corrective retry, which is application logic. The gateway's own retry is left off so retries do not stack.
- Estimated backfill: about 8,854 tours, about 0.002 USD each, about 18 USD on Sonnet 5 (unverified prices).
- The one eligible tour on a draft Experience gets copy when its Experience is promoted and the next run happens.
- The BRI-206 research tool keeps its own local file guard. It calls DataForSEO, not a model, and is unaffected.

## Follow-up

- [ ] Calibration (build step 9) is the gate before any backfill: nonzero cost shown for the model in use (Sonnet 5 first, and again for any other allowlisted model before its first backfill), a test limit that really returns 429, the two kinds of 429 told apart, the check thresholds tuned, and the gateway figure compared with the Anthropic console.
- [ ] Consider a preflight in the CLI that reads the gateway configuration through Cloudflare's API and refuses `--execute` when no enabled spend rule exists. It needs a second Cloudflare token with read scope, so it is left out for now.
- [ ] If a durable run history is wanted later, add a small `TourCopyRun` table (run id, start and end, counts, token totals, exit reason). It was left out of this version.
- [ ] Web story: render `aiSummary`, escape it as untrusted text, and decide whether it carries a visible label. Add the field to the web type.
- [x] BRI-201: absorb the inline check and the voice counters, add a check for spelled out numbers, and add the sampled evaluation. This spec's check then becomes its first gate.
- [ ] Wire the Railway cron for nightly generation as a separate step, after Roy approves. It needs the two gateway variables in Doppler `prd`.
- [ ] Update `docs/08-brand-voice-style-guide.md`: line 24 (a price example) and line 27 (Roy's firsthand knowledge) do not apply to tour copy and must not be carried into the prompt, and the calibration example states facts outside tour fields.
- [ ] Update `docs/02-system-architecture-specification.md` section 12: cancellation policy is listed as grounding input, which conflicts with BRI-204, and the section should say model calls go through the gateway.
- [ ] Update the `modules/content` entry in `apps/api/AGENTS.md` once the CLI exists (it currently says the gate is not called by anything), and add the gateway to its deployment notes.
- [ ] Revisit the Batch API only if the catalogue grows well past the current 30,157 live tours. Check first that the gateway supports it.
- [x] This feature is enrolled in `docs/scope/_root/scope.md` as row 8, with the web render (row 9) and the nightly cron (row 10) enrolled as its follow up features.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
