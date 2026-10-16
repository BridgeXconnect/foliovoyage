# 0006. Hub copy in the house voice, and the batch calibration (child of 0006 SEO proving slice)

Scope rows 23 and 24. Governed by [index.md](index.md): the copy file schema, hashes and live set live there.

## Summary

The content engine learns one new input, a slice page. For each page it writes three fields (an intro, an SEO title and a meta description), each through the same generate, check and one corrective retry loop as tour copy, using the existing gateway adapter. The voice guide's banned patterns, the leak list and claim tracing are blocking checks. Roy reads and fact checks each page (copy, Local notes, Good to know, pick images and the share image), and `hub-copy:approve` records that check against `checkHash` in the copy file; only then can the page go live. (Amended 16 Oct 2026: the generator never sees notes or picks, never writes in the first person, and never names a tour or operator; the check now covers notes, source facts, picks and the share image.) The first batch of topic pages (6 today, with 2 pages held for thin data) is held to a threshold fixed before any generation.

## Requirements

**User stories**:
- As Roy, I want page copy in the house voice that states only things I can check, so that the pages follow F1 without a per item rewrite.
- As Roy, I want a fixed pass bar before I generate anything, so that I judge the approach, not individual pages.

**Acceptance criteria**:
- **AC-H1**: `doppler run -- pnpm --filter @folio/api hub-copy:run --page {slug}` (or `--all`) runs `apps/api/src/modules/content/hub-copy.cli.ts`. It reads the manifest and the page's snapshot from the content folder, builds the grounding (AC-H2), and generates each field with `TourCopyAnthropicGenerator` through Cloudflare AI Gateway. The model comes from `HUB_COPY_MODEL` (default `claude-sonnet-5`), declared in `apps/api/src/config/env.validation.ts` as an optional string beside `TOUR_COPY_MODEL`; the CLI checks at startup that the resolved model is on `TOUR_COPY_ALLOWED_MODELS` and exits non zero if not. The adapter gains an optional `maxTokens` constructor option (default 400, as today); hub copy passes 1000. Gateway metadata sends `tourId` as `seo:{slug}:{field}`.
- **AC-H2**: The grounding is the snapshot `facts` (for a category page this includes `sections` with their labels and `strip` with its labels; for the hub, `pages`), and from the manifest page its `h1`, `targetQuery`, `rule.plainWords` (none for the hub and stats), the manifest's `exclusions.plainWords`, and its `sourceFacts` (possibly empty), each in a delimited data block in the user message. `groundingHash` is computed over exactly these inputs, as in index.md. The snapshot's `eligible` block never enters the grounding, so every number the copy may state is a printable count (index.md AC-9) and a gated count fails the number trace (AC-H3). Two more things never enter the grounding or the prompt: the notes file (notes are rendered verbatim and never paraphrased, index.md) and the picks (so a pick only refresh keeps the copy valid, and the copy cannot single out a tour).
- **AC-H2a**: The system prompt (`hub-copy-prompt.ts`) adds three rules to the voice guide: write about the tours and the data only, never as someone who has been there (no first person, no "we visited", no sensory scene the data does not hold); never name a single tour, product or operator; and describe the page's sections and its rule as the reader's way to choose, using only the labels in the grounding. Changing these rules bumps `HUB_COPY_PROMPT_VERSION`.
- **AC-H3**: Each field passes a pure check, `checkHubCopy(field, candidate, grounding)` in `hub-copy-check.ts`, that fails on any of:
  - a leak term from `SEO_SLICE_LEAK_TERMS` (AC-T6);
  - a banned voice pattern from `docs/08`, now blocking (any count above 0 fails): the tour copy voice counters `emDash`, `contrastiveReveal` and `clicheOrIntensifier`, reusing their term lists;
  - an unsourced number: every digit run, spelled number and month name must appear in the grounding (reusing `tour-copy-numbers.ts`);
  - an untraced place: every name from the manifest `places` (AC-S8) and the off city list (AC-M3) must appear in the grounding;
  - a first person or team claim (reason `firstPerson`): any whole word `I`, `I'm`, `I've`, `me`, `my`, `we`, `we're`, `we've`, `us`, `our` or `ours`, or a phrase from `SEO_SLICE_TEAM_TERMS` (AC-T6). The copy speaks about the page, never as its author, so the only firsthand voice on a page is the signed Local notes;
  - length: intro 120 to 220 words; `seoTitle` at most 60 characters; `metaDescription` at most 155 characters;
  - for the intro only: its first sentence holds at least one number or place present in the snapshot `facts` (the checkable opening fact). The prompt also asks the intro to state the curation logic; Roy's read checks that, since no word rule can.
- **AC-H4**: A field that fails gets exactly one corrective retry with one fixed sentence per failed reason code, as in `generateChecked`. A refusal is a failure. A page fails generation when any field fails after its retry; the CLI then writes no copy file for it and prints the reasons.
- **AC-H5**: A passing page is written to `{slug}.copy.json` (index.md schema) with `promptVersion` from `HUB_COPY_PROMPT_VERSION` in `hub-copy-prompt.ts`, `attempts` as the highest attempt count across the three fields, and no `factCheck`. Writing new copy removes any old `factCheck`. Both `hub-copy:run` and `hub-copy:approve` finish by running `seo:index` (index.md, Files).
- **AC-H6**: `pnpm --filter @folio/api hub-copy:approve --page {slug} --by {initials}` computes `checkHash` (index.md: the copy fields, the notes, the page's `sourceFacts`, the snapshot's `picksHash`, the page's `ogImageExperienceId` and that pick's `imageUrl`, and the printed manifest strings in `rendered`) and writes `factCheck { by, at, checkHash }`, `at` being now. It refuses (exit non zero, writing nothing) when:
  - the copy's `groundingHash` does not match the current snapshot and manifest;
  - the page's notes file exists and fails validation (index.md, Notes file schema), including the leak scan, the `firstPerson` check and the name check;
  - a `sourceFacts` entry fails the leak scan or lacks `url` or `checked`;
  - the page has no `ogImageExperienceId`, or it is not the `experienceId` of one of the page's picks (for the stats page, of any category page's picks), or that experience is on `excludedExperiences`.

  `factCheck.by` is a record for the repo, never rendered (index.md AC-7); the leak scan fails if it ever shows up in HTML. When only the picks changed (AC-S7), you run `approve` again after looking at the new cards; no regeneration is needed.
- **AC-H7**: The stats page copy file holds only `seoTitle` and `metaDescription`, made by the same command and checks. It is fact checked like the others and does not count toward the calibration. When the stats page fails generation after its corrective retry (AC-H4), or fails Roy's read, you set `"held": true` on it in the manifest and the slice launches without it. No other page depends on it: the hub does not list it, so holding it changes no other page's facts or `checkHash`. Its failure is recorded in the calibration file beside the batch, and fixing it follows AC-H11 (prompt, guide or checks, never its text).
- **AC-H8**: The copy never states price, availability or cancellation (enforced by AC-H3) and never names a single tour's rating or review count.
- **AC-H9**: The hub (`things-to-do`) is generated, checked, rendered in the local preview (AC-T15) and fact checked first, before any category page is generated. It cannot be live at that point (it is live only once every page it lists is ready, index.md AC-2), so the preview is how you read it; it goes live later, with the category pages, without a second read unless its `checkHash` changed.
- **AC-H10**: Batch calibration, fixed before any generation. The batch is every topic page that is not held and has a snapshot: 6 today (the hub plus 5 category pages), 8 if both held pages return. A page fails when it fails generation after its corrective retries (AC-H4) or fails Roy's read. The batch fails when 2 or more pages fail.
- **AC-H11**: When the batch fails, change only the prompt, the guide or the checks (never one page's text), bump `HUB_COPY_PROMPT_VERSION`, and regenerate the whole batch. At most 2 such rounds. If 2 or more pages still fail after round 2, stop: the next step is a decision on a documented human pass exception to F1, not more rounds.
- **AC-H12**: When the batch passes with exactly 1 failed page, that page is resampled unchanged up to 2 more times. If it still fails, it is held: you set `"held": true` on it in the manifest, rerun `seo:snapshot` (the hub's facts and cards drop it) and regenerate and fact check the hub, all in one PR (index.md AC-8), and the slice launches without it. **The hub is the exception.** If the failed page is the hub (`things-to-do`), it is never held: every category and the stats page are live only while the hub is live (index.md AC-2), so holding it would take the whole slice offline. You stop instead: no slice page launches, and the next step is a decision with Roy (change the hub's prompt or template, accept a documented human pass on the hub as an F1 exception, or end the slice), recorded in the calibration file. The same applies if the hub fails generation in AC-H9, before the batch runs. Every round, every resample and every held page is recorded in `docs/superpowers/plans/2026-10-15-seo-slice-calibration.md` with the page, the reasons and the prompt version.
- **AC-H13**: The fact check read, done by Roy before each `approve`, on the local preview (`pnpm --filter @folio/web seo:preview`, then the page's `/destinations/bangkok/{slug}` URL on `localhost:3000`; AC-T15). The preview needs no Doppler and does not go through Turbo, which matters because `doppler run -- pnpm dev` does not work through Turbo today (BRI-246, Backlog). It covers, in this order:
  1. The copy: every claim matches the page's facts and rule, and the intro states the curation logic.
  2. Local notes (category pages that have them): each still true today, and none names a tour or operator. Roy writes notes by hand; they are never generated.
  3. Good to know: each fact still matches its source link, and `checked` is today or recent enough to stand behind.
  4. Pick images: each card's photo shows the tour, not a stock or unrelated scene. A photo that does not is added to the manifest's `excludedExperiences` with a short `reason`; you then rerun `seo:snapshot` (the tour stays a member and is never picked, AC-M10) and look again.
  5. The share image: set `ogImageExperienceId` to a pick whose photo is right for the page.

  When all five hold, run `approve`. Nothing on the page is edited by hand except the notes, the manifest data above and the exclusions; a copy problem is a calibration failure (AC-H10).

## Decision

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Engine | The existing `TourCopyGenerator` port and gateway adapter | Same audited path, budget and logging as tour copy | A new client |
| Model | `HUB_COPY_MODEL`, default `claude-sonnet-5`, on the same allowlist | Separate knob, same guard | Reuse `TOUR_COPY_MODEL` |
| Fields | Three separate generations, each with its own check and retry | Keeps each check simple and each retry targeted | One JSON response |
| Claim tracing | Deterministic: numbers, months and named places must be in the grounding; everything else rests on Roy's read | A rule that cannot be gamed by paraphrase; the human check covers meaning | A model judge |
| Fact check record | `factCheck` in the copy file, tied to `checkHash` (copy, notes, source facts, picks, share image, printed manifest strings) | Any edit to what Roy read unpublishes the page until he reads it again | Tied to the copy only (`copyHash`), which let a notes or pick change go live unread |
| Generator inputs | Facts, rule and source facts only; never notes, never picks | Notes stay verbatim and firsthand; copy cannot single out a tour | Notes as grounding to paraphrase (the BRI-212 framing) |
| Voice | No first person, enforced as a blocking check | Generated text must not claim experience; notes carry that, signed | First person allowed in the house voice |
| Threshold | 2 or more of the batch fail, at most 2 prompt rounds | Set before generation so a result cannot move the bar | Per page pass only |
| A failed hub | Stop and decide, never hold | Every other page depends on the hub being live | Hold it like a category page |

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
| `factCheck.at` | now, at `approve` |
| `factCheck.checkHash` | `canonicalHash` of the inputs listed in AC-H6 (index.md recipe) |

**Configuration required**:
- `HUB_COPY_MODEL`: model id for slice copy, default `claude-sonnet-5`, must be on `TOUR_COPY_ALLOWED_MODELS`. Add to `env.validation.ts`, `apps/api/.env.example` and Doppler `dev`. Copy runs locally only, so it needs no `railway.ts` entry.
- Uses the existing `AI_GATEWAY_BASE_URL` and `AI_GATEWAY_TOKEN`.

**Critical test scenarios**:
- A candidate with "free cancellation" fails `leak` and is retried once, verifies **AC-H3**, **AC-H4**.
- An intro with a number not in the facts fails, verifies **AC-H3**.
- A pick only snapshot refresh leaves `groundingHash` valid; a facts change, or an edit to the page's `h1` or `rule.plainWords`, makes `approve` refuse, verifies **AC-H2**, **AC-H6**.
- Editing `intro`, a note, a `sourceFacts` entry or `ogImageExperienceId` after approval makes the page not live; a snapshot that changes only the picks also does, until `approve` runs again, verifies **AC-H6** (with index.md AC-2).
- An intro with "we" or "our editors" fails `firstPerson`, verifies **AC-H3**.
- The built user message holds the snapshot's printable `facts` and no value from `eligible`; an intro that states an `eligible` count fails the number trace, verifies **AC-H2**, **AC-H3**.
- The built user message for a page with a notes file holds no note text and no pick title, verifies **AC-H2**.
- `approve` refuses with a missing `ogImageExperienceId`, one that is not a pick, one on `excludedExperiences`, a notes file whose text names a pick's title, and a note that says "we" or "our", verifies **AC-H6**.
- Editing a printed manifest string (a tag name, a keyword label, a listed page's `h1` on the hub) after approval makes the page not live; on the stats page, a refresh that changes the Open Graph pick's `imageUrl` does too, verifies **AC-H6** (with index.md Hashes).

## Build plan

1. Adapter `maxTokens` option, satisfies **AC-H1**.
2. Prompt, check and per field loop with tests, satisfies **AC-H2**, **AC-H2a**, **AC-H3**, **AC-H4**, **AC-H8**.
3. `hub-copy:run` and `hub-copy:approve`, satisfies **AC-H1**, **AC-H5**, **AC-H6**, **AC-H7**.
   - [ ] For `groundingHash` and `checkHash`, add the same pinned assertions against the shared fixture in apps/api (`packages/shared/fixtures/seo-slice-golden.json`, as pinned in `apps/web/src/lib/seo-slice/golden.spec.ts`).
4. Generate the hub, read it in the local preview (AC-T15) and fact check it, satisfies **AC-H9**, **AC-H13**.
   - [ ] places list entry 'Erawan' is ambiguous (museum, shrine, national park): check any intro that names it, and consider changing it to 'Erawan National Park' in the manifest
5. Roy writes the notes files for floating markets, temples and day trips; generate the topic batch, fact check each page, run the calibration, record the result, satisfies **AC-H10**, **AC-H11**, **AC-H12**, **AC-H13**.

## Rationale (short)

F1 rules out per item human rewriting, so the bar has to sit in the prompt and the checks, and the calibration exists to tune those, never single pages. Tying approval to a hash over everything Roy read makes the fact check a fact, not a promise, and keeps "Checked by the Folio team" true. Keeping notes and picks out of the generator is what lets the page carry firsthand notes without any generated sentence claiming experience.
