# Content Engine Research Plan (BRI-200, BRI-201, BRI-202)

> **This is a research and planning document, not an implementation plan.** It has no code tasks on purpose. Nothing here changes `schema.prisma`, opens a PR, or edits Linear. Each section ends in a recommendation you can accept, change, or skip, plus the decisions that are yours to make.

**Goal:** Before any architecture is locked in for the AI content engine (EP-15, BRI-120), find out what is really needed, what established practice already solves, and where the three backlog tickets filed on 2026-09-19 (BRI-200, BRI-201, BRI-202) are wrong or naive.

**Architecture of this document:** One section per ticket. Each section works out the need again from the code, summarises prior art, lays out two to four real options with trade offs, and ends with a recommendation and the decision points that depend on your budget, risk tolerance or priorities. A short cross ticket section covers ordering.

## How to read the tags

Every factual statement carries a tag.

- **[V]** means verified. Either against this repo's code (cited as `file:line`), against read only queries of the production database (dated), against a local benchmark I ran (described in section 3), or against an external source (linked).
- **[I]** means inference, judgment or recommendation. It might be well reasoned, but I did not verify it directly.

Where a ticket's framing is wrong, the text says **Ticket correction** in bold.

## What I touched while researching (full disclosure)

- **Production database, read only.** I ran `SELECT` aggregates against the Neon project `morning-tree-78193800` (counts, distributions, one 40 row sample of Experience titles). I wrote nothing. [V]
- **Local scratch database.** I created `bri202_scratch` on the local docker `folio-postgres` (port 5433), applied all 18 migrations, ran the benchmark, and dropped it afterwards. The existing `folio` dev database was not touched. [V]
- **Linear, read only.** I read BRI-120, 142, 146, 154, 200, 201, 202 (read only). I changed nothing. [V]
- **Repo.** The only file added is this document. No schema, code, commit or PR. [V]

## Headline findings

1. **BRI-200 (eligibility gate).** The rating and review count parts can be built today. The completeness part cannot yet: `reviewsBySource` (Task 4) does not exist anywhere in the repo, and only 2,317 of 30,132 tours (7.7%) carry the image gallery, inclusions, exclusions and cancellation policy from Tasks 1 to 3. **Ticket correction:** "feed `QuarantinedTour`" is the wrong home for ineligible tours (section 1.4). [V]
2. **BRI-201 (eval harness).** The ticket is right that it must exist from day one. The research sharpens it: put cheap deterministic checks on 100% of generated copy, use a second LLM claim check only on a sample, and note that `source_hash` is a poor regeneration key for BRI-154 because it changes when a review count changes. [V for the hash contents, I for the consequence]
3. **BRI-202 (linker dedup at volume).** **Ticket correction, three ways.** (a) `ExperienceLinker` has no dedup logic at all, it creates one Experience per tour keyed on the source id. (b) It has already run at about 30,000 rows in production, not 2.5K. (c) There is one provider today, so "duplicates across providers" does not exist yet. The linker scales roughly linearly in my benchmark up to 100,000 rows. What is real is a canonical clustering need for same activity listings (BRI-146), which is a business decision more than a performance one. [V]
4. **Side finding.** `ExperienceAutoPromoter` skips roughly one row per 1,000 on a first run because of how it pages (section 3.6). It heals on the next nightly run. Not fixed here. [V for the symptom, I for the mechanism]

---

## Section 1: BRI-200, eligibility and scoring gate

### 1.1 What is actually needed (re-derived from code)

The ticket says: decide whether a tour is worth generating copy for before generation runs, start rules based on fields already on `Tour`, and answer what happens to ineligible tours. [V: BRI-200 description]

**The fields a gate can score against today.** Fill rates are from a production read on 2026-09-19 over 30,132 active tours. [V]

| Field | Schema | Filled in prod | Note |
| --- | --- | --- | --- |
| `description` | `schema.prisma:168` | 30,126 have 100 or more characters, 20,945 have 500 or more | Provider text, so the raw material is already there [V] |
| `ratingAvg` | `schema.prisma:172` | 16,353 rated (54.3%) | Null when the provider has no reviews [V] |
| `ratingCount` | `schema.prisma:174` | 7,010 have 1 to 4, 4,349 have 5 to 19, 4,994 have 20 or more | 13,779 (45.7%) have none [V] |
| `priceMinor` / `priceReferenceMinor` | `schema.prisma:177`, `:184` | 30,129 have a reference price above zero | Reference price is USD, set at ingest [V] |
| `imageUrl` | `schema.prisma:199` | 30,132 (all) | Not a discriminating signal [V] |
| `images` (gallery) | `schema.prisma:208` | 2,317 (7.7%) | Task 1 [V] |
| `inclusions` / `exclusions` | `schema.prisma:213`, `:214` | 2,317 / 1,978 | Task 2 [V] |
| `cancellationPolicy` | `schema.prisma:219` | 2,317 | Task 3 [V] |
| `latitude` / `longitude` | `schema.prisma:193`, `:195` | 697 (2.3%) | Missing geo is deliberately not quarantined (`validator.ts:15-33`) [V] |
| `tags` | `schema.prisma:228` | 14,832 (49.2%) | Raw Viator tag ids, unresolved [V] |
| `durationMin` | `schema.prisma:170` | not measured | [V that the field exists] |
| `reviewsBySource` | none | not present | Task 4 is not built. A search of the repo for the name finds nothing. [V] |

**The completeness gap is a data problem, not a code problem.** Every one of the 2,317 rows with a gallery has the same `fetchedAt` (2026-09-19 07:40:13), which is the run that shipped after Tasks 1 to 3. The other 27,815 rows were last fetched between 2026-08-19 and 2026-09-18, before the capture code existed. [V] The nightly import is a cursor based delta (`docs/superpowers/plans/2026-09-01-bri181-cursor-delta-imports.md`), so an unmodified product is not fetched again. [V that the plan exists, I that this is why the rest stay empty] A completeness rule applied today would exclude about 92% of the catalogue until a full recrawl. [I]

**What `QuarantinedTour` holds and how it is populated.**
- It stores a rejected tour's full `TourDTO` in `payload`, the `reasonCodes` and `reasons`, and the `sourceHash` (`schema.prisma:260-277`). [V]
- Only `TourValidator` writes to it (`quarantine-store.prisma.ts:21-24`, via `prisma.quarantinedTour.create`). The four codes are `MISSING_TITLE`, `MISSING_PRICE`, `NON_POSITIVE_PRICE`, `COORDINATES_OUT_OF_RANGE` (`validator.ts:45-48`). [V]
- Every save is a plain `create`, and the index on `(provider, providerTourId)` is not unique (`schema.prisma:277`), so the same tour can be quarantined repeatedly. [V]
- Production holds 897 rows, all `MISSING_PRICE`, all written between 2026-09-04 21:02 and 21:48, one row per tour. That is a single incident, not a steady flow. [V]

**There are four different gates, and the ticket blurs them.** [I, built from the code below]

| Layer | Question it answers | Where it lives today |
| --- | --- | --- |
| L0 Import integrity | Is the record valid enough to store? | `TourValidator`, then `QuarantinedTour` (`validator.ts`) [V] |
| L1 Publish | Does the Experience get a public page at all? | `ExperienceAutoPromoter.isPromotable`, which checks draft status, non empty title and description, image, affiliate URL and reference price above zero (`experience-auto-promoter.ts:37-46`) [V] |
| L2 Copy eligibility | Is it worth spending an LLM call on this tour? | Nothing yet. This is BRI-200 [V that it does not exist] |
| L3 Indexability | Does Google get to index this page? | Nothing yet. This is BRI-142 (`docs/02` line 397) [V] |

**The L1 gate discriminates nothing.** 30,134 of 30,137 Experiences are published, and the 3 drafts match the 3 tours that have no positive reference price (30,132 tours, 30,129 with one). [V for the counts, I that the match is the cause]

### 1.2 How BRI-200 and BRI-142 relate

BRI-142 (ST-30) is "min words, unique summary, at least 1 image, at least 3 experiences, else `noindex`" (BRI-142 description, `docs/02` line 397). [V]

- **They are different gates at different stages, not the same gate.** BRI-200 runs before generation and scores one tour to decide whether to spend money on copy. BRI-142 runs at render or publish time and scores one page to decide whether to let search engines index it. [I]
- **They are linked in one direction.** BRI-142's "min words" and "unique summary" tests will be judged on the copy BRI-200/154 produce. A page full of tours that failed BRI-200 will tend to fail BRI-142 for lack of copy. So BRI-200's output (an eligible/ineligible flag with reasons) is an input BRI-142 should read. [I]
- **BRI-142's "at least 3 experiences" is a page level rule.** It fits destination and category pages, and does not fit a single Experience page. The ticket does not say which pages it covers. [V that the text is silent, I that this needs clarifying]
- **BRI-142 is not built and the site is not live.** No quality gate exists in `apps/web`. `noindex` appears only on `image-credits`, `coming-soon`, filtered `search` results and the `/go` redirect (`apps/web/src/app/image-credits/page.tsx:11`, `coming-soon/page.tsx:7`, `search/page.tsx:38`, `go/[slug]/[id]/route.ts:100`). While the pre launch gate password is set, `robots.ts` disallows everything (`apps/web/src/app/robots.ts:14`). [V]

### 1.3 Prior art

- **Google gives principles, not numbers.** The spam policies define *scaled content abuse* as generating many pages primarily to manipulate rankings without adding value, and say generative AI used that way counts. They also define *thin affiliation* as affiliate pages built from merchant supplied descriptions without original contribution. [V: <https://developers.google.com/search/docs/essentials/spam-policies>]
- **AI use itself is not the violation.** Google's generative AI page says AI content is fine when it adds value, and asks for accuracy, quality and relevance. It also says merchants should label AI generated product titles and descriptions as such in feeds. [V: <https://developers.google.com/search/docs/fundamentals/using-gen-ai-content>]
- **The "value beyond the source" test is the one that matters here.** Google's self assessment asks whether content that draws on other sources adds substantial value beyond those sources rather than repeating them. [V: <https://developers.google.com/search/docs/fundamentals/creating-helpful-content>] This is the biggest risk for BRI-154: copy generated only from Viator's own structured fields is a rewrite of Viator's own content, at 30,000 page scale. [I]
- **No page I read gives a numeric floor** for reviews, ratings or word count. Common floors (review count, rating, word minimums, completeness scores) are practitioner heuristics. The only numbers in this repo are BRI-142's own. [V that Google's pages give none, I that the rest is practitioner lore]
- **`noindex` mechanics.** It is set with a meta tag or an `X-Robots-Tag` header. The page must be crawlable (not blocked by robots.txt) or Google never sees the directive, and removal can take months for a page that is rarely recrawled. [V: <https://developers.google.com/search/docs/crawling-indexing/block-indexing>] That makes `noindex` a slow, reversible dial and "do not generate or publish the page" a fast, blunt one. [I]

### 1.4 Options

**Option A. Rules only, gate the copy step, leave the page alone.** Ineligible tours get no AI copy and keep showing the provider's description. No page is removed or hidden.
- Pros: cheapest; no revenue risk; nothing to unpublish; matches how the site works today. [I]
- Cons: thin pages stay live. A page with no AI copy is exactly the thin affiliation shape Google describes, so this leans entirely on BRI-142 catching them. [I]

**Option B. Rules gate, plus a stored outcome that BRI-142 reads.** Same as A, and each Experience records `eligible`, a list of reason codes and a gate version. BRI-142 then `noindex`es pages made up mostly of ineligible tours.
- Pros: one source of truth; re-evaluable when thresholds change; mirrors the `reasonCodes` habit already used by `QuarantinedTour`. [I]
- Cons: needs a schema change (not made here) and BRI-142 built first or alongside. [I]

**Option C. Do not publish ineligible tours.** Change L1 so they never reach `published`.
- Pros: strongest protection against thin content. [I]
- Cons: the promoter never un-publishes (`experience-auto-promoter.ts` guards every write with `status: "draft"`), and 30,134 rows are already published, so this needs new demote logic and gives up affiliate clicks on long tail tours. [V for the promoter behaviour and counts, I for the consequence]

**Option D. Route ineligible tours to `QuarantinedTour`** (the ticket's second idea).
- **Not recommended.** Quarantine is an integrity store: it keeps a full payload per row, has no dedup, no re evaluation path, and one incident wrote 897 rows. Up to 92% of the catalogue could land there under a completeness rule, so it would copy roughly 28,000 payloads for no benefit. It also mixes "bad data" with "unremarkable but valid data". [V for the structure, I for the judgment]

**Scoring style, independent of the above.** A weighted score (for example 0 to 100) versus plain boolean rules. Boolean rules with a logged breakdown are easier to explain and change. A weighted score only pays off once there is data on what predicts good copy or clicks, and there is not. [I]

### 1.5 Recommendation and decision points

**Recommend Option B, built as a pure function** (input: a tour's fields, output: eligible flag plus reason codes), the same shape as `isPromotable` and `normalizeViatorProduct`, so it is unit testable with no database. Start with two rules that are buildable today and defend a plain story: a minimum review count and a rating floor. For scale, 4,994 tours have 20 or more reviews, of which 4,814 rate 4.0 or higher (16%), and 9,343 tours have 5 or more reviews (31%). [V for counts, I for the recommendation] Add completeness rules only after the recrawl question below is settled. Keep `QuarantinedTour` for import integrity only.

**Decision points for you:**
1. **What ineligible tours become.** Stay listed with provider text (A/B), or leave the site (C). This depends on how much you value long tail affiliate clicks against thin content risk. I cannot derive it from engineering.
2. **The thresholds.** A floor of 5 reviews unlocks about 31% of tours, 20 unlocks about 17%. That is directly a copy cost and quality trade, and depends on budget (section 2.4 has the per page cost).
3. **A full recrawl.** Completeness scoring needs the Task 1 to 3 data on the other 27,815 tours, which means a full refetch from Viator. That is time, API load and a policy question (the API audit is `docs/13-viator-api-audit.md`). Either pay for it, or gate on rating and review count first and let completeness follow.
4. **How much "value beyond Viator's own text" the copy must add** to be comfortable at scale. This is the Google risk in 1.3, and it is a risk appetite call.

---

## Section 2: BRI-201, sampled eval and QA harness

### 2.1 What is actually needed (re-derived from BRI-154)

BRI-154's design, in its own words (updated 2026-09-19): [V: BRI-154 description]
- Generate `ai_summary` as `status='published'`, not a draft awaiting approval.
- Store provenance: model, prompt version, timestamp, and the tour's `source_hash` at generation time.
- Constrain prompts to the provided structured data, with no fabricated prices, availability or cancellation terms.
- Regenerate when `source_hash` changes.
- A sampled share of published copy is checked by the eval harness, "the actual quality backstop, not per item approval".

The code confirms nothing is built yet: no `ai_summary` column or code exists in `apps/api`, `prisma` or `packages/shared`. [V]

**Three findings that change the harness design:**

1. **`source_hash` includes ratings and excludes price.** The hash covers title, description, duration, `rating_avg`, `rating_count`, affiliate URL, images, inclusions, exclusions, cancellation policy and others, but not price (`normalizer.ts:317-337`, ratings at `:324-325`). [V] So every new review changes the hash and would trigger regeneration and a fresh chance to hallucinate, while a price change never does. [V for the contents, I for the consequences, I did not measure how often ratings change]
   Recommendation: hash only the fields the copy is allowed to state, and keep ratings and prices out of the prose so they render from the database at page time. [I]
2. **`docs/02` §12 still says the opposite of BRI-154.** It says "human approval before publish" and AI content "stored as drafts" (`docs/02-system-architecture-specification.md:406`). BRI-154 superseded that on 2026-09-19. The AGENTS.md doc hierarchy says requirements change in doc 02 first. [V] Fix doc 02 before building. [I]
3. **The grounding material is small and structured.** Title, provider description, duration, inclusions, exclusions, cancellation policy, ratings. That is nothing like a RAG corpus, which shapes the tooling choice below. [I, from the schema in 1.1] It is also thin today: only 2,317 tours have inclusions or cancellation policy captured. [V]

**What the harness must actually check.** [I]
- Every number, currency amount, duration and time window in the copy exists in the source fields.
- No cancellation, refund or availability claim that the cancellation policy does not support.
- No claim about inclusions or exclusions that contradicts the checklists.
- Tone and voice against `docs/08-brand-voice-style-guide.md`, in aggregate, not per item.
- Drift by prompt version and by model, so a bad prompt is caught before it reaches thousands of pages.

### 2.2 Prior art

**Frameworks, verified against their current docs:**

| Tool | What it does | What it needs | Fit here |
| --- | --- | --- | --- |
| promptfoo | YAML and CLI driven. Deterministic assertions (`contains`, `regex`, `is-json`, `javascript`, `python`) plus model graded ones (`llm-rubric`, `g-eval`, `factuality`, `context-faithfulness`). The grader model is configurable and can be Claude. Runs in CI with `promptfoo eval`. [V: <https://www.promptfoo.dev/docs/configuration/expected-outputs/>, <https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/>] | `context-faithfulness` needs a context variable and the output | Native to a TypeScript stack. Best for pre release regression on a fixed set of prompts and tours [I] |
| DeepEval | Python. Faithfulness metric extracts claims from the output, extracts truths from `retrieval_context`, and scores truthful claims over total claims. Default threshold 0.5, any custom judge model. [V: <https://deepeval.com/docs/metrics-faithfulness>] | `input`, `actual_output`, `retrieval_context` | Same pattern, but adds a Python service to a Node repo [I] |
| Ragas | Python. Faithfulness decomposes the response into statements and checks each against retrieved contexts, score is supported over total. Built for RAG. It also mentions a classifier (Vectara HHEM 2.1 Open) as a cheaper hallucination detector. [V: <https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/>] | `user_input`, `response`, `retrieved_contexts` | Same pattern again, RAG framing is a poor match for a closed schema [I] |

**What they really differ on.** All three implement the same claim decomposition then verify loop for faithfulness. The differences are ecosystem (YAML/JS versus Python), reporting, and how many other metrics come bundled. It is not a difference in the core technique. [I]

**Judge cautions from the field.** LLM judges show position, verbosity and self enhancement bias (they score their own outputs higher), and a judge should be calibrated against human labels before it is trusted. [V: <https://www.langchain.com/resources/llm-as-a-judge>] So the judge should be a different model or size than the generator, and its recall should be measured. [I]

**Typical sampling.** Cheap rule checks (schema, PII, citations) run on all traffic, LLM judges on roughly 1% to 10%, with 5% to 10% cited for ongoing monitoring of medium risk content, and 100% of high risk cases. [V: <https://latitude.so/blog/realtime-evaluation-strategies-llms>] This is vendor guidance, not a standard. [I]

**Sample size matters more than percentage.** To see at least one bad item with 95% confidence you need about 3 divided by the defect rate: about 299 samples for a 1% defect rate, 59 for 5%, 29 for 10% (from ln(0.05) / ln(1 − p)). [I, standard arithmetic] At 30,000 pages a 1% sample is 300 pages, so a flat percentage is fine at scale. A bad prompt version usually hits a whole batch, so a small sample per prompt version catches it. [I]

### 2.3 Options

**Option A. Adopt promptfoo as the whole harness.** Golden set of tours, assertions, run in CI and on a sample of production output.
- Pros: least custom code, familiar CI flow, works with Claude as grader. [V for capabilities, I for effort]
- Cons: `context-faithfulness` is a general prompt, not tuned to price, availability and cancellation risks, and cannot exact match numbers as reliably as code can. [I]

**Option B. Bespoke two layer check.** Layer 1: deterministic code on 100% of generations (numbers, amounts, durations and cancellation phrases must appear in the source fields). Layer 2: a second LLM call on a sample that lists each claim in the copy and labels it supported, unsupported or contradicted, quoting the source field.
- Pros: the source is a small closed schema, so numbers can be checked exactly with no LLM at all; the judge sees the whole source with no retrieval noise; prompts target travel specific risks. [I]
- Cons: you own the judge prompt and must calibrate it. [I]

**Option C. Bespoke plus promptfoo for regression only.** Option B in production, and promptfoo (or plain Jest) running a golden set of about 50 to 100 tours on every prompt or model change.
- Pros: catches a bad prompt before it ships, which is the failure the ticket fears most. [I]
- Cons: two moving parts. [I]

**Option D. Human spot check only.** A person reads a sample each week.
- Pros: no tooling. [I]
- Cons: does not scale to thousands of pages, and BRI-150 (the per item moderation queue under BRI-120) was canceled, so per item review is already off the table. [V that BRI-150 is canceled, I for the conclusion]

### 2.4 Cost, so the sampling decision has numbers

Prices are from Anthropic's pricing page: Sonnet 5 is $2 input and $10 output per million tokens, Haiku 4.5 is $1 and $5, and the Batch API is 50% off both. [V: <https://platform.claude.com/docs/en/about-claude/pricing>] Token counts below are my assumptions, so treat the results as order of magnitude. Newer models use a tokenizer that produces about 30% more tokens than older ones, which the page states. [V for the tokenizer note, I for the assumptions]

| Step (assumed tokens) | Per page | 30,000 pages |
| --- | --- | --- |
| Generation on Sonnet 5 (about 1,500 in, 250 out) | about $0.0055 | about $165 ($82 batch) |
| Claim check on Sonnet 5 (about 2,250 in, 300 out) | about $0.0075 | about $225 at 100% |
| Claim check on Haiku 4.5, batch | about $0.0019 | about $56 at 100% |
| Claim check on Sonnet 5 at a 10% sample | about $0.0075 | about $22 |

[I, computed from [V] prices and assumed tokens] Checking every page with an LLM is affordable at this size. The reason to sample is not cost, it is that a sample plus the deterministic layer is enough to catch systematic failure. The cost only becomes a real constraint if the catalogue grows by a large factor. [I]

### 2.5 Recommendation and decision points

**Recommend Option C.** Deterministic checks on 100% of generations as a blocking step (a page that fails falls back to provider text and is retried, never published with bad copy). A second LLM claim check on a stratified sample, with a floor of about 60 pages per prompt version and city rather than a flat percentage, plus 100% for the first 50 generations of any new prompt version. A golden set run in promptfoo or Jest before any prompt or model change. Calibrate the judge by seeding known errors (a wrong price, a false cancellation claim) and measuring how many it catches. Use a different model or size for the judge than for generation. Also fix the two design issues in 2.1 (regeneration key, doc 02) before building. [I]

**Decision points for you:**
1. **Blocking or advisory.** Should a failed deterministic check stop a page from getting AI copy, or only flag it? Blocking is safer and drops some copy; advisory ships more pages. This is risk tolerance.
2. **What happens when a sample fails.** Pause generation for that prompt version and revert affected pages to provider text? That needs a way to revert AI copy separately from Experience status (the promoter never unpublishes). Whether you want an automatic kill switch is your call.
3. **Human time.** Is a periodic human spot check (for example 30 to 50 pages per prompt version) acceptable to you, or must it be fully automated? The canceled BRI-150 moderation queue points to automated, but a small sample read is not per item review.
4. **May the copy state ratings and prices?** Keeping them out of the prose makes the checks simpler and the hash calmer, at the cost of less specific copy.
5. **Judge budget.** Whether to spend on a stronger judge model or accept Haiku class checking.

---

## Section 3: BRI-202, ExperienceLinker dedup at volume

### 3.1 What the linker actually does

The ticket says the linker's "dedup/auto-promotion logic has only run against about 2.5K rows". [V: BRI-202 description] The code says something different.

- **There is no dedup logic.** For each unlinked tour that maps to a curated city, `linkRun` creates exactly one draft Experience keyed on `(sourceProvider, sourceProviderTourId)` and links the tour to it (`experience-linker.ts:97-203`; unique key at `schema.prisma:133`). Two tours with the same title become two Experiences. Its own header says it "stands in for real editorial dedup" (`experience-linker.ts:16-18`). [V]
- **Auto promotion is not dedup either.** `isPromotable` checks that a draft has a title, description, image, affiliate URL and reference price (`experience-auto-promoter.ts:37-46`). [V]
- **Shape of the algorithm.** One `city.findMany` (`:100`), one unpaginated `tour.findMany` filtered by `provider`, `deletedAt: null`, `experienceId: null` and `destinationRefs hasSome` (`:118-135`), then a sequential loop where each new tour costs an `experience.create` (`:221`) and a `tour.updateMany` (`:191`), with a `findUnique` only on a unique constraint race (`:241`). There are no pairwise comparisons, so it is linear in unlinked tours, not quadratic. [V]
- **No index on `destinationRefs`.** The indexes on `Tour` are `(provider, deletedAt)` and `experienceId` (`schema.prisma:251`, `:253`). The `hasSome` filter is a scan within those rows. [V]

**Ticket corrections on volume and providers.** [V]
- Production already holds 30,132 active tours, 30,137 Experiences, and no unlinked tours. The "2.5K" figure is out of date, and `apps/api/AGENTS.md` still says the scope filter keeps "~90 curated products", which is also stale (line 91 to 93).
- Only Viator is a provider today. The `QuarantinedTour` schema comment says the provider is "always viator today" (`schema.prisma:262`). Cross provider duplicates cannot exist yet. [V for the comment, I for the conclusion]

### 3.2 Synthetic volume test (real evidence)

**Method.** Isolated database `bri202_scratch` on the local docker Postgres (port 5433), all 18 migrations applied, the six curated cities seeded. N synthetic tours per run, generated in SQL with the production city mix (Hanoi 29.5%, Rome 22.8%, Bali 22.4%, Lisbon 12.4%, Bangkok 8.6%, Kyoto 4.3%), about 3.3% with geo (production is 2.3%), all with image, affiliate URL, reference price and an 400 character description. I ran the real `ExperienceLinker.linkRun("viator")` and then `ExperienceAutoPromoter.promoteEligible("viator")` through ts-node. The database was on the same machine, so **network latency is zero, a best case.** [V]

| Tours | Link time | Rows per second | Re run (nothing to link) | Promoter time |
| --- | --- | --- | --- | --- |
| 3,000 | 7.4 s | 404 | 11 ms | 0.18 s |
| 10,000 | 25.1 s | 398 | 18 ms | 0.89 s |
| 30,000 | 45.8 s | 656 | 33 ms | 1.78 s |
| 100,000 | 160.3 s | 624 | 110 ms | 8.72 s |

[V] Peak resident memory of the process at 100,000 tours was 328 MB against about 82 MB before the run. That is about 2.5 KB per tour, which grows linearly because `linkRun` loads every unlinked row at once. [V for the measurement, I for the per row figure]

**What the numbers say.**
- **The complexity is linear, and it is not degrading at 10x to 30x.** Throughput held at roughly 400 to 650 rows per second from 3K to 100K. [V] The ticket's concern about "10 to 15x the row count" does not show up as an algorithmic problem. [I]
- **Steady state is trivial.** A re run with nothing to link took 110 ms at 100,000 rows. Nightly delta imports link only new tours. [V]
- **The real limits are elsewhere:** (1) production round trips (about 2 to 3 per new tour), (2) memory from the unpaginated load, (3) a whole run that dies on the first bad tour. Details next. [I]

### 3.3 The real scale risks

1. **Round trip latency in production.** Locally a tour costs about 1.6 ms. Against Neon over the network at an assumed 5 to 20 ms per round trip, that is roughly 10 to 40 ms per new tour, so a first pass over 100,000 tours would take about 17 to 67 minutes. [I, from the measured local rate and an assumed latency] Recent full production import runs took between 9 minutes and 1 hour 37 minutes (`ImportRun`, 2026-09-16 to 2026-09-19). [V] `experience-auto-promoter.ts:76-79` records that long sequential per row writes previously outlived Neon's connection lifetime and dropped mid run, and the linker still has that shape. [V for the comment, I that the risk applies to the linker]
2. **Memory.** The unpaginated `findMany` grows about 2.5 KB per unlinked tour, so a first pass over a large new city is bounded by the host memory limit. BRI-182 exists for exactly this class of problem in the crawl. [V for the plan file existing, I for the applicability]
3. **A single bad tour aborts the run.** If a tour has no geo and its city has no centroid, `linkRun` throws `ExperienceGeoUnavailableError` (`experience-linker.ts:175`). [V] I did not check whether every production City row has a centroid. If one lacks it, a tour without geo in that city would abort the nightly link stage and leave every later tour unlinked. [I, scenario]
4. **No progress logging.** The linker logs one summary line at the end (`:198-201`), and a project memory note (2026-09-05, not re verified today) says the 15 to 20 minute silent gap during finalize is normal and that re triggering mid gap kills the run. [I, carried forward from memory]

### 3.4 What is genuinely needed: canonical clustering

The real problem behind the ticket is not "does the linker hold up", it is "many near identical listings become many near identical pages". Production shows it already: **553 groups of tours share a case insensitive title, 773 excess rows (2.6% of active tours).** [V: query on `lower(title)` over active tours, 2026-09-19] A 40 row sample I read showed different Viator product codes with the same title. [V for the sample, I that they are distinct supplier listings of the same activity]

This is BRI-146 (ST-34, "Deduplication into canonical Experiences"), which is in M6 and not started. Its stated approach is "geo proximity + title similarity + provider", deterministic, reviewable, golden file tested. [V: BRI-146 description] **A large caveat: geo is filled for only 2.3% of tours** (697 of 30,132), so geo proximity cannot be a primary key today. Title within city is the usable signal. [V for the fill rate, I for the conclusion]

**Established practice for entity resolution.** The standard shape is normalize, then block (generate candidate pairs cheaply so you never compare all pairs), then score. All against all comparison is quadratic, which is why blocking exists. [I, general practice from search results I read but did not verify against a primary source] Postgres `pg_trgm` supports this: `similarity()` and the `%` operator default to a 0.3 threshold, and a GIN or GiST trigram index makes similarity lookups fast. [V: <https://www.postgresql.org/docs/current/pgtrgm.html>] For scale, the largest city today (Hanoi, 8,879 tours) would be about 39 million pairs unblocked, which a city block plus a trigram index avoids. [I, arithmetic from a [V] count]

### 3.5 Options

**Option A. Close the premise, harden the linker.** Record that the linker does no dedup and has been proven at 30K in production and 100K locally. Then make small changes: keyset paginate the tour load, log progress, make a missing centroid skip and warn rather than abort, add a duplicate audit query to the run report.
- Pros: cheap; fixes the real scale risks; no policy decisions. [I]
- Cons: leaves the near duplicate pages in place. [I]

**Option B. Exact normalized title clustering within a city (BRI-146, first cut).** Normalize titles (case, punctuation, whitespace), group within a city, pick a canonical Experience per group, keep the rest as variants.
- Pros: deterministic, reviewable, catches the 773 excess rows measured today, needs no geo and no new dependency. [V for the count, I for the rest]
- Cons: misses near matches ("Half Day Cooking Class" versus "Cooking Class, Half Day"). [I]

**Option C. Add fuzzy matching (`pg_trgm`) inside the city block.** Trigram similarity with a tuned threshold, reviewed on a sample before trusting it.
- Pros: catches near duplicates. [I]
- Cons: needs a threshold, a review sample, and a GIN index (a schema change). the similarity threshold needs tuning against real titles before you trust it. [I]

**Option D. Cross provider matching when a second provider exists.** Not needed until then. [I]

### 3.6 Side finding: the auto promoter skips rows on a first run

My benchmark left drafts unpromoted every time: 2 of 3,000, 9 of 10,000, 29 of 30,000 and 99 of 100,000. In the 30,000 run the leftover drafts were the tours numbered 1001, 2002, 3003 and so on, so exactly the first row after each 1,000 row page boundary. [V] The mechanism is very likely that `experience-auto-promoter.ts:108` pages with `cursor` plus `skip: 1` while the `where` clause filters on `status: "draft"`, and the previous page's `updateMany` (`:129-133`) has just turned the cursor row into `published`, so the cursor row is gone and `skip: 1` skips the next row instead. [I, consistent with the code, not confirmed by a fix]

Impact in production is small: leftover rows are picked up by the next run, and the 3 production drafts match the 3 tours with no reference price. [V for the counts, I for the match] I did not change it. It is worth its own ticket. [I]

### 3.7 Recommendation and decision points

**Recommend Option A now, Option B as its own scoped story when catalogue expansion resumes, and Option C only if a reviewed sample shows Option B misses real duplicates.** Rewrite BRI-202 to say the premise was wrong and the risk is throughput, memory and failure handling, not dedup correctness. File the promoter paging bug separately. [I]

**Decision points for you:**
1. **Which page wins when several listings are the same activity.** The canonical choice decides which supplier's affiliate link earns. That is a business and revenue decision, not an engineering one.
2. **Merge or keep variants.** One page per activity with several booking options, or separate pages that link to each other. This is an SEO and product call and ties to the Google scaled content risk in 1.3.
3. **How much duplication is acceptable.** 2.6% of tours share a title today. Whether that matters enough to build BRI-146 before expansion depends on your priorities.
4. **Timing.** Catalogue expansion is on hold behind the content engine, so nothing here is urgent. Whether to harden the linker now or wait is a sequencing preference.

---

## Cross ticket sequencing

Recommended order. [I]

1. **Fix the design inputs first (small):** update `docs/02` §12 to match BRI-154, and decide the regeneration key (a grounding hash, not the full `source_hash`).
2. **BRI-200 rules now,** on rating and review count only. Completeness follows the recrawl decision.
3. **BRI-201 deterministic layer built with BRI-154,** so it exists on the first generation. The sampled LLM check and the golden set follow immediately.
4. **BRI-142 after BRI-200,** because it reads BRI-200's outcome.
5. **BRI-202 hardening any time,** independent of the rest. BRI-146 clustering when expansion resumes.

## Suggested ticket corrections (not applied, Linear is untouched)

- **BRI-200:** replace "feed `QuarantinedTour`" as an option, add the four layer model, and note that `reviewsBySource` does not exist.
- **BRI-201:** add the two design inputs (regeneration key, doc 02 §12) as prerequisites, and state the two layer approach.
- **BRI-202:** retitle to reflect throughput, memory and failure handling, correct "2.5K" to about 30K, and remove "across providers" until a second provider exists. Link BRI-146 for clustering.

## Out of scope

- Any code, schema, migration, PR, or Linear change.
- Choosing the copy prompts, tone, or the brand voice (see `docs/08-brand-voice-style-guide.md`).
- A full recrawl or any deploy. Nothing here goes live without your go ahead.
- Resolving Viator API policy questions (see `docs/13-viator-api-audit.md`).

## Self-Review

**Spec coverage:**
- BRI-200: fields and their fill rates (1.1), what `QuarantinedTour` holds and how it fills (1.1), Google guidance and noindex (1.3), the BRI-142 relationship stated explicitly (1.2), options with a recommendation and decision points (1.4, 1.5). ✅
- BRI-201: BRI-154 design re read (2.1), frameworks verified against current docs (2.2), sampling rates and sample size (2.2), where a bespoke check beats a framework (2.3), cost math (2.4), recommendation and decision points (2.5). ✅
- BRI-202: linker logic and complexity read (3.1), a synthetic benchmark at 3K, 10K, 30K and 100K (3.2), real risks (3.3), entity resolution kept proportionate to the finding (3.4), options, recommendation, decision points (3.5, 3.7). ✅
- Ticket corrections called out for all three (headline findings and inline). ✅

**Tag audit:** Every factual statement is tagged [V] or [I]. Where a sentence mixes both, each part is tagged separately. Numbers derived from verified inputs are tagged [I] and name their inputs (sections 2.2, 2.4, 3.3). ✅

**Placeholder scan:** No TBD or unresolved language. The one measurement I could not take, production network latency for the linker, is stated as an assumption (5 to 20 ms per round trip) and tagged [I], not left blank. ✅

**Known limits of the evidence:**
- The benchmark database was local, so the throughput figures are a best case. [V]
- Memory was sampled as a peak only for the 100,000 run. The 3K to 30K runs recorded an end of run figure only, so I quote only the 100K peak. [V]
- Token counts for the cost table are assumptions. [I]
- Sampling guidance comes from vendor documentation, not a standard. [I]
- The duplicate title count uses exact case insensitive matching, so it understates near duplicates. [I]
- An earlier check this session counted 969 excess title rows using a slightly different method. The figure here (773) is the one just re measured with the query stated above. [V]

**Code actually read for each area:** `schema.prisma` (Tour, QuarantinedTour, Experience), `normalizer.ts`, `validator.ts`, `quarantine-store.prisma.ts`, `upsert.ts`, `curated-cities.ts`, `experience-linker.ts`, `experience-auto-promoter.ts`, `apps/web/src/app/robots.ts`, `layout.tsx`, `docs/02` §11 to §12, and both `AGENTS.md` files. ✅
