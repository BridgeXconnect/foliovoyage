# 0006. Hub copy in the house voice, and the batch calibration (child of 0006 SEO proving slice)

Scope rows 23 and 24. Governed by [index.md](index.md): the copy file schema, hashes and live set live there.

## Summary

The content engine learns one new input, a slice page. For each page it writes three fields (an intro, an SEO title and a meta description), each through the same generate, check and one corrective retry loop as tour copy, using the existing gateway adapter. The voice guide's banned patterns, the leak list and claim tracing are blocking checks. Roy reads and fact checks each page, and `hub-copy:approve` records that check in the copy file; only then can the page go live. The first batch of topic pages (6 today, with 2 pages held for thin data) is held to a threshold fixed before any generation.

## Requirements

**User stories**:
- As Roy, I want page copy in the house voice that states only things I can check, so that the pages follow F1 without a per item rewrite.
- As Roy, I want a fixed pass bar before I generate anything, so that I judge the approach, not individual pages.

**Acceptance criteria**:
- **AC-H1**: `doppler run -- pnpm --filter @folio/api hub-copy:run --page {slug}` (or `--all`) runs `apps/api/src/modules/content/hub-copy.cli.ts`. It reads the manifest and the page's snapshot from the content folder, builds the grounding (AC-H2), and generates each field with `TourCopyAnthropicGenerator` through Cloudflare AI Gateway. The model comes from `HUB_COPY_MODEL` (default `claude-sonnet-5`), declared in `apps/api/src/config/env.validation.ts` as an optional string beside `TOUR_COPY_MODEL`; the CLI checks at startup that the resolved model is on `TOUR_COPY_ALLOWED_MODELS` and exits non zero if not. The adapter gains an optional `maxTokens` constructor option (default 400, as today); hub copy passes 1000. Gateway metadata sends `tourId` as `seo:{slug}:{field}`.
- **AC-H2**: The grounding is the snapshot `facts`, and from the manifest page its `h1`, `targetQuery`, `rule.plainWords` (none for the hub and stats), the manifest's `exclusions.plainWords`, and its `sourceFacts` (possibly empty), each in a delimited data block in the user message. `groundingHash` is computed over exactly these inputs, as in index.md. Picks are not in the grounding, so a pick only refresh keeps the copy valid.
- **AC-H3**: Each field passes a pure check, `checkHubCopy(field, candidate, grounding)` in `hub-copy-check.ts`, that fails on any of:
  - a leak term from `SEO_SLICE_LEAK_TERMS` (AC-T6);
  - a banned voice pattern from `docs/08`, now blocking (any count above 0 fails): the tour copy voice counters `emDash`, `contrastiveReveal` and `clicheOrIntensifier`, reusing their term lists;
  - an unsourced number: every digit run, spelled number and month name must appear in the grounding (reusing `tour-copy-numbers.ts`);
  - an untraced place: every name from the place list (AC-S8) and the off city list (AC-M3) must appear in the grounding;
  - length: intro 120 to 220 words; `seoTitle` at most 60 characters; `metaDescription` at most 155 characters;
  - for the intro only: its first sentence holds at least one number or place present in the snapshot `facts` (the checkable opening fact). The prompt also asks the intro to state the curation logic; Roy's read checks that, since no word rule can.
- **AC-H4**: A field that fails gets exactly one corrective retry with one fixed sentence per failed reason code, as in `generateChecked`. A refusal is a failure. A page fails generation when any field fails after its retry; the CLI then writes no copy file for it and prints the reasons.
- **AC-H5**: A passing page is written to `{slug}.copy.json` (index.md schema) with `promptVersion` from `HUB_COPY_PROMPT_VERSION` in `hub-copy-prompt.ts`, `attempts` as the highest attempt count across the three fields, and no `factCheck`. Writing new copy removes any old `factCheck`. Both `hub-copy:run` and `hub-copy:approve` finish by running `seo:index` (index.md, Files).
- **AC-H6**: `pnpm --filter @folio/api hub-copy:approve --page {slug} --by roy` computes `copyHash` from the file's current fields and writes `factCheck { by, at, copyHash }`. It refuses (exit non zero) when the copy's `groundingHash` does not match the current snapshot and manifest.
- **AC-H7**: The stats page copy file holds only `seoTitle` and `metaDescription`, made by the same command and checks. It is fact checked like the others and does not count toward the calibration.
- **AC-H8**: The copy never states price, availability or cancellation (enforced by AC-H3) and never names a single tour's rating or review count.
- **AC-H9**: The hub (`things-to-do`) is generated, checked, rendered and fact checked first, before any category page is generated.
- **AC-H10**: Batch calibration, fixed before any generation. The batch is every topic page that is not held and has a snapshot: 6 today (the hub plus 5 category pages), 8 if both held pages return. A page fails when it fails generation after its corrective retries (AC-H4) or fails Roy's read. The batch fails when 2 or more pages fail.
- **AC-H11**: When the batch fails, change only the prompt, the guide or the checks (never one page's text), bump `HUB_COPY_PROMPT_VERSION`, and regenerate the whole batch. At most 2 such rounds. If 2 or more pages still fail after round 2, stop: the next step is a decision on a documented human pass exception to F1, not more rounds.
- **AC-H12**: When the batch passes with exactly 1 failed page, that page is resampled unchanged up to 2 more times. If it still fails, it is held: you set `"held": true` on it in the manifest, rerun `seo:snapshot` (the hub's facts and cards drop it) and regenerate and fact check the hub, and the slice launches without it. Every round, every resample and every held page is recorded in `docs/superpowers/plans/2026-10-15-seo-slice-calibration.md` with the page, the reasons and the prompt version.

## Decision

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Engine | The existing `TourCopyGenerator` port and gateway adapter | Same audited path, budget and logging as tour copy | A new client |
| Model | `HUB_COPY_MODEL`, default `claude-sonnet-5`, on the same allowlist | Separate knob, same guard | Reuse `TOUR_COPY_MODEL` |
| Fields | Three separate generations, each with its own check and retry | Keeps each check simple and each retry targeted | One JSON response |
| Claim tracing | Deterministic: numbers, months and named places must be in the grounding; everything else rests on Roy's read | A rule that cannot be gamed by paraphrase; the human check covers meaning | A model judge |
| Fact check record | `factCheck` in the copy file, tied to `copyHash` | An edit after approval silently unpublishes the page | A separate approvals file |
| Threshold | 2 or more of the batch fail, at most 2 prompt rounds | Set before generation so a result cannot move the bar | Per page pass only |

## Feature design

**Files** in `apps/api/src/modules/content/`: `hub-copy-prompt.ts`, `hub-copy-check.ts`, `hub-copy-generate.ts` (the per field loop), `hub-copy.cli.ts`, `hub-copy-approve.cli.ts`, plus specs. Scripts `hub-copy:run` and `hub-copy:approve`.

**Value sourcing**:
| Value | Source |
|---|---|
| `intro`, `seoTitle`, `metaDescription` | the model, after the checks pass |
| `groundingHash` | `factsHash` from the snapshot plus the manifest inputs listed in AC-H2 |
| `model` | `HUB_COPY_MODEL` |
| `promptVersion` | `HUB_COPY_PROMPT_VERSION` |
| `factCheck.by` | the `--by` flag |
| `factCheck.copyHash` | `canonicalHash` of the current fields |

**Configuration required**:
- `HUB_COPY_MODEL`: model id for slice copy, default `claude-sonnet-5`, must be on `TOUR_COPY_ALLOWED_MODELS`. Add to `env.validation.ts`, `apps/api/.env.example` and Doppler `dev`. Copy runs locally only, so it needs no `railway.ts` entry.
- Uses the existing `AI_GATEWAY_BASE_URL` and `AI_GATEWAY_TOKEN`.

**Critical test scenarios**:
- A candidate with "free cancellation" fails `leak` and is retried once, verifies **AC-H3**, **AC-H4**.
- An intro with a number not in the facts fails, verifies **AC-H3**.
- A pick only snapshot refresh leaves `groundingHash` valid; a facts change, or an edit to the page's `h1` or `rule.plainWords`, makes `approve` refuse, verifies **AC-H2**, **AC-H6**.
- Editing `intro` after approval makes the page not live, verifies **AC-H6** (with index.md AC-2).

## Build plan

1. Adapter `maxTokens` option, satisfies **AC-H1**.
2. Prompt, check and per field loop with tests, satisfies **AC-H2**, **AC-H3**, **AC-H4**, **AC-H8**.
3. `hub-copy:run` and `hub-copy:approve`, satisfies **AC-H1**, **AC-H5**, **AC-H6**, **AC-H7**.
4. Generate, render and fact check the hub, satisfies **AC-H9**.
5. Generate the topic batch, run the calibration, record the result, satisfies **AC-H10**, **AC-H11**, **AC-H12**.

## Rationale (short)

F1 rules out per item human rewriting, so the bar has to sit in the prompt and the checks, and the calibration exists to tune those, never single pages. Tying approval to a hash makes the fact check a fact, not a promise.
