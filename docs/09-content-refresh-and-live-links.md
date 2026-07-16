# 09 — Content Refresh + Live Viator Links

**Read first, in full, before starting:** `docs/06-viator-api-integration-guide.md`, `docs/07-viator-integration-brief.md`, `docs/08-brand-voice-style-guide.md`

This task combines three things in one pass:

1. Wire up real Viator affiliate links (per doc 07's exact process — destination ID resolution, match-don't-overwrite, campaign params, caching approach).
2. Revise existing copy against doc 08's style guide — homepage, all 6 destination pages, blog posts, About/footer copy. Audit for every banned pattern in doc 08 and rewrite offending passages. Specifically retarget every "written by hand" framing sitewide to "vetted"/"researched and checked" per doc 08's examples.
3. Update project documentation:
   - Locate the existing Tech Debt Register in `docs/02-system-architecture-specification.md` and add an entry in its existing format (match the existing TD-N numbering and structure exactly — don't invent a new format) along these lines: no backend/database built yet; frontend fetches and caches Viator data directly (Next.js ISR); rationale: Basic Access doesn't support bulk ingestion so a backend had nothing to manage; trigger to revisit: Full Access approval.
   - Create `docs/10-adding-a-new-destination-playbook.md` documenting the repeatable process for adding a new destination without a database pipeline: (a) call `/products/search` for the new destination as research, not content, (b) write original guide + experience copy per doc 08's voice guide, (c) match written experiences to real Viator products and attach `affiliateUrl` per doc 07's process, (d) publish. Note explicitly that this process is fully repeatable right now and does not require Full Access or a database.

## Order of operations

1. Read all three referenced docs in full.
2. Do the Viator wire-up (doc 07's process) for all 6 existing destinations.
3. Do the content/voice revision pass across the whole site.
4. Update the Tech Debt Register.
5. Write the new destination playbook (doc 10).

## Definition of done

- Same as doc 07's definition of done, for the API wire-up.
- No instance of "written by hand" (or equivalent overclaim) remains anywhere on the site.
- No paragraph anywhere has more than one em dash; none of doc 08's banned constructions remain.
- Tech Debt Register has a new, correctly-formatted entry for the no-backend-yet decision.
- `docs/10-adding-a-new-destination-playbook.md` exists and is genuinely usable as a standalone how-to.
