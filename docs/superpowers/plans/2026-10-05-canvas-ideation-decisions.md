# Discovery: map (EP-20 shelved → EP-21)

**Epics:**
- **EP-20** (BRI-223), discovery canvas: **shelved 8 Oct.**
- **EP-21** (BRI-244), bucket discovery views (masonry): the successor. It inherits this map.

**Path:** `docs/superpowers/plans/2026-10-05-canvas-ideation-decisions.md`. The path is kept; the file was restructured as a map on 8 Oct (BRI-243).

**Status:** living document. Update it after each prototype round.
- The planning chat owns the map's structure and decisions.
- A Claude Code session edits only the items its task resolved, and says so in its report.

## How this file relates to the others

- **Spec 0004** (`docs/specs/_root/0004-discovery-canvas/`):
  - The feed-endpoint sub-spec stays in force.
  - The layout, navigation and tile-design sub-specs are superseded by the shelving (marked in BRI-245).
  - Changes reach code only through `/architect`, as a new EP-21 spec.
- **Plans folder.** `2026-09-27-canvas-design-brief.md` < `2026-10-01-canvas-design-decisions.md` < this file. Both earlier files are canvas-era history.
- **Prototype:** `~/dev/canvas-Gallery/atlas-layouts/`, branch `layout-explorations`, unpushed.
  - Rounds 1 and 2 cover layout directions A–I (F skipped), and there is a curation picker.
  - Each round's README there holds its rules and results.
  - Round 3 is masonry only.
- **Paper:** paused 8 Oct. See Parked.

## How to read this map

- **Decided:** confirmed by Roy, or fixed by data, terms or the shipped spec.
- **Open:** every item carries four things.
  - **ID:** `O<n>`. IDs are stable; never renumber.
  - **Type:**
    - `grilling`: Roy's call, made in an interview.
    - `prototype`: answered with throwaway code in canvas-Gallery.
    - `research`: answered by reading or measuring.
    - `task`: a human must do it.
  - **Status:**
    - *proposed*: recommended, not confirmed.
    - *evidence pending*: waiting on another item.
    - *ready*: the evidence is in, so it can be decided now.
  - **Blocks:** what the item holds up.
- **Parked:** deliberately not being worked on, with the condition that would reopen it.
- **Gate for the EP-21 `/architect`:** O1, O2, O5, O13 and O17 must reach Decided first.

## Why the direction is changing

- **Friends' review** of the production canvas on mobile: panning a dense wall of images is overwhelming.
- **The designer's review:** the overwhelm is largely an image-curation failure. Tours are curated by rating, images not at all. His example: a text-overlay promo photo next to a skyline shot pulls the eye away from the skyline.
- **8 Oct, Roy and the designer:** the canvas is a nice add-on, not a reliable core feature, mainly on usability. It is shelved. Discovery uses masonry and other layout options over the same bucket data.

## Decided

- **The canvas is shelved (8 Oct).**
  - Its view layer is removed under BRI-245.
  - Its feed (BRI-225), the tour page (BRI-236) and the image curation work carry into EP-21.
- **Unchanged from spec 0004, and carried into any new direction:**
  - **cap and tiers** (AC-T1): 50 tiles per bucket; ranks 1–4 `lg`, 5–20 `md`, 21–50 `sm`;
  - **ranking:** the Bayesian score;
  - **caption heights** (AC-T2, AC-L4): fixed tokens of 68, 57 and 14 px, never measured;
  - **captions below the photo**, with title clamps of 2, 2 and 1 lines;
  - **exit tile** (AC-T6): 240×160, the only solid-accent element, copy "Explore {City} →".

  The 150-tile mount guard is a separate safety limit, not the per-bucket cap.
- **Layout stays a pure function** (0004 Rationale): deterministic, seeded per id, with no DOM or font measurement. Masonry and every other layout is a layout function over the same tile set.
  - **Positions** sit on the 8 px grid.
  - **Caption heights** are the token values above. Round 2 of the prototype rounded them to 72/64/16, which was wrong; future rounds use the tokens.
- **Semantic zoom (LOD) was kept** as a shared rendering layer over any layout. Prototype thresholds: far < 35%, mid 35–80%, near > 80%. Positions never change with zoom. Whether it survives without the canvas is O17.
- **Masonry is the default bucket view.**
- **Type runs throughout a bucket, not only as a hero:** type, stock and tour tiles are blended.
- **Image curation is a required stage.** Every image, tour or stock, passes gates before it reaches a curated surface. The gate spec comes from the picker labels (O1).
- **Image data supports curation.** Every tour stores a gallery in `Tour.images`. On `dev`, the median is 13.5 images per tour for Bangkok × Food & Drink and 17.5 for Hanoi × Outdoor Activities, the minimum is 5, and no tour has only one.
  - **Today's choice** (`canvas-image.ts`): the `isCover` entry, else the first.
- **GIPHY is rejected.** Its terms forbid mixing it with other providers in one grid, forbid reordering or filtering it, and restrict caching.
- **Geo layout (prototype F) is parked on data** (see Parked).
  - **Prod:** 17,791 of 30,573 tours (58.2%) have coordinates (checked 5 Oct).
  - **`dev`:** 2 of 16 Bangkok × Food & Drink tours and 0 of 120 Hanoi × Outdoor Activities tours have real, non-centroid positions.
  - **BRI-227:** 58.2% is its coordinate baseline.
- **Design surface (8 Oct):** open design questions are answered in the code prototype, not in Paper.

## Open

### Evidence-gathering (do these first)

**O1 · `task` · Curation picker labels** · *evidence pending*
- **Reviewers:** Roy covers both buckets; the designer covers Bangkok's 16 tours. `labels-yilmaz.json` exists, so check the regenerated `curation/summary.md` for progress.
- **Protocol:** one `best` per tour, and rejects (with a reason) only for clear defects.
- **What they answer:** the gate spec, and whether reviewer agreement is high enough to automate taste.
- **Also watch:** the rate at which today's cover image is rejected.
- **Blocks:** O2 (needs curated images), O5, and the gate spec.

**O2 · `prototype` · Round 3, mobile (390 px): editorial masonry with curated images** · *evidence pending, on O1*
- **Blocks:** O3, O10, O14, O17.

**O3 · `task` · Friends test on round 3** · *evidence pending, on O2*
- The same reviewers who found the production canvas overwhelming.
- **Blocks:** confirming masonry holds up on mobile.

### Waiting on evidence

**O5 · `grilling` · Choose the curated `best` image instead of the cover (AC-T8 and `canvas-image.ts`)** · *proposed, evidence pending on O1*
- Tier and shape still never come from the source image.
- **Choosing `best`:** the most beautiful image that still honestly shows the tour, never a more attractive but unrepresentative one.
- **Blocks:** the image-selection spec.

**O9 · `grilling` · Two bucket tiers** · *proposed*
- *Featured buckets:* a finite set, rotated seasonally. They get art direction and human image sign-off. (They were also to get the canvas mode, which is now parked.)
- *Everything else:* automatic gates and editorial masonry.
- 0004's 42 real buckets are the starting population for this split.
- **Blocks:** the human sign-off workload.

**O10 · `prototype` · Stock atmosphere tiles** · *proposed, evidence pending on O2*
- atmosphere tiles only, never inside a tour tile;
- credited on the tile;
- at most 1 per 6 tour tiles;
- never cropped;
- clips muted and looping, playing only in view at mid or near zoom, at most 2 at once, and poster-only under reduced motion.
- **Blocks:** O16 (only matters if stock survives round 3).

**O11 · `grilling` · Pinterest landing** · *proposed*
- A single-tour pin goes to the tour page; a collection pin goes to the bucket.

**O13 · `research` · Layout compute budget per bucket** · *evidence pending*
- The prototype's semantic-zoom layout took 3 s per call before a fix, so `/architect` must set a budget.
- Measure the masonry layout function on the largest real bucket.
- **Blocks:** whether layout runs at request time or is precomputed.

**O14 · `prototype` · Type scale** · *evidence pending on O2*
- Likely a mix (poster-size display, editorial elsewhere).

**O15 · `grilling` · Animation is an accent** · *proposed, after layout is settled*
- `transform` and `opacity` only, restrained on mobile. The library is chosen after the layout is settled.

**O17 · `grilling` · Does semantic zoom (LOD) survive without the canvas?** · *evidence pending on O2*
- A masonry view may scroll rather than zoom.
- **Blocks:** whether LOD is in the EP-21 spec.

## Parked

- **Canvas mode (EP-20, shelved 8 Oct).** These items are parked with it:
  - **O4 · Remove jitter and tilt** (AC-L2): moot. Masonry has straight columns.
  - **O6 · Masonry default plus a canvas mode, entered from a tile in the masonry.** The masonry-default half is Decided.
  - **O7 · One canvas mode at launch**, tracking switch rate.
  - **O8 · Mobile canvas snaps between sections or spreads.**
  - **O12 · Canvas mode direction:** prototype I (A's spread head plus a masonry tail) with G's type-led treatment.

  **Reopen** only if masonry ships and engagement data argues for an immersive mode as an add-on.
- **O16 · `research` · Production stock source.** Pexels has paused new API keys, and the prototype stock is hand-picked. **Reopen** only if stock tiles survive round 3 (O10).
- **Geo layout (prototype F).** Coordinate coverage is too low (see Decided). **Reopen** if BRI-227 and later backfills lift `dev` buckets to ≥70% distinct non-centroid coordinates.
- **Paper (paused 8 Oct).** Its outputs are captured in spec 0004 and `2026-10-03-paper-04-resume-status.md`: the token names, the caption heights 68/57/14 and the clearance result. Paper file `01M3VHFY502GXVVB8RJ9VW1QBH` is kept. **Reopen** only for a static-artboard question the prototype can't answer.

## Known doc inconsistencies (not fixed here)

- **1 Oct file:** "Still open" still says 60 tiles and 21–60 `sm`, and its prototype rules say "rotation ±1.5°" without "photo only". Its banner overrides both.
- **Spec 0004, tile-design Decision table:** the caption-height row calls 36.8 a "fractional line height". 36.8 is the two-line `md` total; the line height is 18.4. The line-44 arithmetic is correct. Fix this when 0004 is next touched.
- **Clearance figures are three different measurements; never quote them as one number:**
  - 10.61 px: one sample bucket, 60 tiles, Paper data;
  - 8.09 px: the minimum over 0004's 42 real buckets, rendered geometry;
  - 6.4 px: the same buckets, whole tile modelled as rotated.
