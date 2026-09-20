# 08 — Brand Voice & Style Guide

**Purpose:** a standing reference for anyone (human or AI-assisted) writing copy for Folio Voyage. Read this before drafting or editing any page content.

## The positioning shift: "hand-picked," not "hand-written"

The site currently oversells manual authorship in places ("written by hand"). That's not a claim worth defending if content was AI-drafted — and it doesn't need to be. **The honest, sustainable claim is curation and judgment, not keystrokes.**

Wherever the site currently claims manual/hand authorship specifically (as opposed to editorial judgment, which is fine to claim), cut the claim. "Independently written, in our own words" is fine to keep — that's about not reprinting press releases or sponsored rankings, which is true regardless of drafting process.

## Cut these patterns — they read as AI-generated

- **Em dashes**: roughly one per paragraph, maximum. Use a comma or a full stop instead by default. If a paragraph has two or more, cut one.
- **The contrastive-reveal construction**: "It's not just X — it's Y" / "This isn't about X, it's about Y." Ban this outright. It's the single most obvious AI tell in travel copy.
- **"Whether you're X or Y"** framings. Just say the specific thing.
- **Stacked intensifiers**: "truly," "genuinely," "incredibly," "utterly," "the perfect blend of." Cut on sight.
- **Generic travel-blog clichés**: "hidden gem," "off the beaten path," "bustling," "nestled," "hustle and bustle," "a stone's throw," "breathtaking," "must-see," "bucket list." If a phrase could appear on literally any destination's page unchanged, it's not doing any work — cut or make it specific.
- **Rule-of-three overuse**: not every sentence needs three examples in a row. Vary it.
- **Uniform sentence rhythm**: if five sentences in a row are all medium-length and similarly structured, break the pattern. Mix a short blunt sentence in.
- **"Come for X, stay for Y"** — retire this formula entirely.

## Write this way instead

- **Specific, checkable detail beats abstract praise.** A price, a street name, an opening time, a specific dish — always better than "amazing" or "unforgettable."
- **Let opinions be blunt.** "Skip this if you've done a floating market before — it's touristy" beats "while some may find it touristy, it still offers a unique experience."
- **Short sentences are allowed.** Not everything needs a subordinate clause.
- **Personal, specific detail wins**, especially anywhere Roy has firsthand knowledge (Bangkok above all) — a genuinely local observation is worth more than three generic sentences of scene-setting.

### Lead with one specific, checkable fact

_Added 2026-09-20, from content-engine voice research (see BRI-201, check 2b). This is new guidance, not a rewrite of a rule above._

Open on one specific fact a reader could verify, not an adjective and not a scene-setting generalization. This is the actual mechanism behind the "Attenborough" register this guide is named for: his effect comes from specificity and restraint, not from grandeur or hedged enthusiasm. "Magnificent" and "extraordinary" do no work; a precise, checkable detail does.

Every generated piece follows this: tour copy, hub copy, and guide/collection copy. The eval harness (BRI-201) checks for it.

**Guide and collection copy (BRI-152) also states its curation logic, not just its verdict.** "This made the list because it's the only one with free cancellation under two hours" beats "this is a great pick." With no human review to vouch for the copy, the stated reasoning is the trust signal. The logic must be the rule that actually selected the item (the curation rule is deterministic, per BRI-152), not a justification invented after the fact.

### Calibration example

_The rewrite below fixes the AI tells listed above. It does not open on a checkable fact, so it does not yet meet the rule in the previous section. Use it for register and rhythm, not as an opening-line template._

**AI-tell version:** "Bangkok isn't just a city — it's a sensory experience that stays with you long after you leave, blending ancient tradition with modern energy at every turn."

**Rewritten:** "Bangkok gets under your skin fast. You'll be planning your next bowl of noodle soup before you've even left the airport queue."

## Process for new and existing content

One rule applies to every content type: **all content is generated, eligibility-gated, and checked in aggregate. None of it is hand-written or hand-edited, item by item.** (Decided 2026-09-20, "F1": the brand speaks. Tracked under BRI-120.) This covers per-tour copy (`ai_summary`, BRI-154), hub/category/attraction copy (BRI-205), and guide and collection copy (BRI-152). There is no separate, human-edited tier for any of them.

This guide is therefore enforced at the engine level, not the item level:

- **Eligibility gate (BRI-200):** decides whether copy is generated at all. Ineligible content gets none.
- **Generation prompt:** the patterns above and the rules below are constraints on the prompt, not an editing checklist for a person.
- **Eval/QA harness (BRI-201):** checks voice and claims in aggregate, on a sample, not item by item. It looks for the banned patterns above and for the positive marker in [Lead with one specific, checkable fact](#lead-with-one-specific-checkable-fact).
- **No per-item human edit, for any content type.** No draft, approval, or scheduling step sits between generation and publish.

See [docs/02 §12](02-system-architecture-specification.md#12-ai-content-generation).

- **Claims about human vetting:** "researched, vetted, fact-checked, and edited" is not true of any content on the site, so don't use that language anywhere or imply it. It applies to no content type, not just tour copy.
- **Existing pages:** the static pages in `apps/web/src/data` predate this rule. They get no retroactive editing pass. What happens to them as cities move onto the generated path is not decided here.
