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

### Calibration example

**AI-tell version:** "Bangkok isn't just a city — it's a sensory experience that stays with you long after you leave, blending ancient tradition with modern energy at every turn."

**Rewritten:** "Bangkok gets under your skin fast. You'll be planning your next bowl of noodle soup before you've even left the airport queue."

## Process for new and existing content

Which rule applies depends on how the content is produced:

- **Hand-authored surfaces (destination pages, guides, collections, hub/category intros):** content can be AI-drafted, but must be substantively human-edited before publishing: facts checked, at least one genuinely specific detail added, generic phrasing cut against the list above.
- **AI-generated per-tour copy (`ai_summary`, BRI-154):** no per-item human edit. It publishes automatically once a tour clears the eligibility gate (BRI-200), so this guide is enforced at the engine level instead of the item level: the patterns above are constraints on the generation prompt, and voice or tone drift is checked in aggregate by the sampled eval/QA harness (BRI-201), not tour by tour. See [docs/02 §12](02-system-architecture-specification.md#12-ai-content-generation).
- **Claims about human vetting:** "researched, vetted, fact-checked, and edited" is true of the hand-authored surfaces only. Don't use that language for AI-generated tour copy, or in a way that implies it covers it.
- The editing pass applies retroactively to the hand-authored surfaces — existing pages should get an editing pass against this guide, not just new content going forward.
