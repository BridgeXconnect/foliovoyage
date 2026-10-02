# Discovery canvas: design decisions from the 1 Oct Paper session

**Epic:** EP-20 (BRI-223) · **Paper file:** `01M3VHFY502GXVVB8RJ9VW1QBH` (via the `paper-desktop` server)
**Save to:** `docs/superpowers/plans/2026-10-01-canvas-design-decisions.md`
**Feeds:** `/architect discovery canvas`, alongside `2026-09-27-canvas-design-brief.md`. Where the two disagree, this file wins, because it is later.

**Provenance.** The decisions under "Layout and tile decisions" are recovered from the 1 Oct planning chat's handoff. The "Also decided on 1 Oct" and "Pending" sections come from the 2 Oct handoff. This is not the full 1 Oct handoff, only its canvas content. Anything marked *proposed* was not confirmed by Roy.

## Layout and tile decisions (carry into `/architect`)

- **Captions sit below the photo, never overlaid,** so legibility doesn't depend on the photo.
- **What each tier shows:**
  - `lg`: title, then duration, price and rating.
  - `md`: title, then duration and price.
  - `sm`: title only.
- **Shape is seeded per tour (~30% 1:1), not by category.** A bucket is city × category, so a category-driven shape would make every bucket uniform.
- **Clamp titles:** 2 lines on `lg` and `md`, 1 line on `sm`. Caption height is then constant per tier, so the layout stays a pure function that the server can also compute, independent of font metrics. The prototype estimated heights instead; that estimate must not ship.
- **Rank 1 sits directly beside the title** on the top row. Recommended, not yet in the layout script.
- **The exit tile** takes an `md` 3:2 footprint and is the only solid-accent element on the canvas.
- **Hover is desktop only:** an accent outline plus an accent title. On mobile, a tap goes straight to the detail page.
- **Rank tiers (*proposed*, confirm in the interview):** ranks 1–4 are `lg`, 5–20 are `md`, 21–60 are `sm`.

## Layout prototype rules

Prototype: `~/dev/canvas-Gallery/atlas-cluster/cluster.mjs` (rewritten on 2 Oct from these documented rules; canvas-Gallery commit `2a132ba`).

- seeded per tour id;
- placed in rank order into the first free spot on an 8 px grid, scored by y + 0.55·x;
- 24 px gutter, 48 px margin;
- the title block and the exit-tile corner are reserved first;
- jitter ±5 px, rotation ±1.5°;
- a 6 px minimum clearance between tilted outlines.

## Also decided on 1 Oct (from the 2 Oct handoff)

- Mobile minimap and search are collapsed behind a button.
- `accent-ink` stays untested until hover and pressed states are built in code.
- Border widths and page 01's line-heights are exempt from the swap test.
- **Textures from the designer's bundle: scrapped.**
- The swap test passed (BRI-223 comment): brand tokens hold, with 208/208 sampled properties restyled.
- **The visual direction is the designer's call,** not part of the Paper pass.

## Still open

- **Tiles per bucket:** 60 is recommended.
- **Exit tile target** while BRI-205's hub pages don't exist. Fallback: the existing city page filtered by category. `/architect` must verify the city page actually supports a category filter.

## Pending from the Paper resume (`paper-04-chrome-resume.md`)

`/architect` needs the results of this session: the Step 1 token names, the caption arithmetic and the clearance result. They are not available yet. Don't spec tile heights from the caption values until they are.

- exit-tile line-heights become tokens;
- dividers become `line-strong`;
- a new search/panel width token (stop borrowing `--container-tile-lg`);
- the `overlay` contract text broadened to cover any dimming layer;
- then the swap regression, with each page activated before reading its bounds.
