# Discovery canvas: ideation decisions, 5 Oct 2026

**Epic:** EP-20 (BRI-223) · **Save to:** `docs/superpowers/plans/2026-10-05-canvas-ideation-decisions.md`
**Status:** living document. It is updated after each prototype round.

## How this file relates to the others

- **Spec 0004** (`docs/specs/_root/0004-discovery-canvas/`) governs the shipped canvas, and it wins on anything shipped. This file does not edit it. Every change proposed here would reach 0004 only through `/architect`, as a new spec that supersedes named ACs.
- **Plans folder.** `2026-09-27-canvas-design-brief.md` < `2026-10-01-canvas-design-decisions.md` < this file. The 1 Oct file's banner already records where 0004 overrides it.
- **Prototype.** `~/dev/canvas-Gallery/atlas-layouts/`, branch `layout-explorations`, unpushed. Rounds 1 and 2 cover layout directions A–I (F skipped); there is also a curation picker. Each round's README there holds its rules and results.

**How to read the labels:**
- **Decided:** confirmed by Roy, or fixed by data, terms or the shipped spec.
- **Proposed:** recommended, not confirmed.
- **Evidence pending:** waiting on a prototype round or a measurement.

## Why the direction is changing

- **Friends' review** of the production canvas on mobile: panning a dense wall of images is overwhelming.
- **The designer's review:** the overwhelm is largely an image-curation failure. Tours are curated by rating, images not at all. His example: a text-overlay promo photo next to a skyline shot pulls the eye away from the skyline.

## Decided

- **Unchanged from spec 0004, and carried into any new direction:**
  - **cap and tiers** (AC-T1): 50 tiles per bucket; ranks 1–4 `lg`, 5–20 `md`, 21–50 `sm`;
  - **ranking:** the Bayesian score;
  - **caption heights** (AC-T2, AC-L4): fixed tokens of 68, 57 and 14 px, never measured;
  - **captions below the photo**, with title clamps of 2, 2 and 1 lines;
  - **exit tile** (AC-T6): 240×160, the only solid-accent element, copy "Explore {City} →".

  The 150-tile mount guard is a separate safety limit, not the per-bucket cap.
- **Layout stays a pure function** (0004 Rationale): deterministic, seeded per id, with no DOM or font measurement. Masonry and every canvas mode are layout functions over the same tile set.
  - **Positions** sit on the 8 px grid.
  - **Caption heights** are the token values above. Round 2 of the prototype rounded them to 72/64/16, which was wrong; future rounds use the tokens.
- **Semantic zoom (LOD) is kept** as a shared rendering layer over any layout. Prototype thresholds: far < 35%, mid 35–80%, near > 80%. Positions never change with zoom.
- **Masonry is the default bucket view.** The canvas becomes a mode the user enters.
- **Type runs throughout a bucket, not only as a hero:** type, stock and tour tiles are blended.
- **Image curation is a required stage.** Every image, tour or stock, passes gates before it reaches a curated surface. The gate spec comes from the picker labels (see "Evidence pending").
- **Image data supports curation.** Every tour stores a gallery in `Tour.images`. On `dev`, the median is 13.5 images per tour for Bangkok × Food & Drink and 17.5 for Hanoi × Outdoor Activities, the minimum is 5, and no tour has only one.
  - **Today's choice** (`canvas-image.ts`): the `isCover` entry, else the first.
- **GIPHY is rejected.** Its terms forbid mixing it with other providers in one grid, forbid reordering or filtering it, and restrict caching.
- **Geo layout (prototype F) is parked on data.**
  - **Prod:** 17,791 of 30,573 tours (58.2%) have coordinates (checked 5 Oct).
  - **`dev`:** 2 of 16 Bangkok × Food & Drink tours and 0 of 120 Hanoi × Outdoor Activities tours have real, non-centroid positions.
  - **BRI-227:** 58.2% is its coordinate baseline.

## Proposed (changes to spec 0004 marked by AC)

- **Remove jitter and tilt (AC-L2, the tilt row of the tile-design Decision).**
  - **Why:** the designer's art direction uses straight, loosely aligned columns.
  - **Performance:** 0004 measured pan p95 on iPhone 16 at 18 ms with photo-only tilt and 17 ms with none, so removing it costs nothing and gains a little.
  - **Simpler layout:** clearance between rotated outlines (AC-L3) also simplifies to plain gutters.
- **Choose the curated `best` image instead of the cover (AC-T8 and `canvas-image.ts`).** Tier and shape still never come from the source image.
- **Masonry default plus a canvas mode.** This adds a layout function and changes navigation. The canvas mode may keep 0004's slot model or replace it; that depends on round 3.
- **One canvas mode at launch.** Track switch rate before adding more.
- **The canvas entry point is a tile inside the masonry**, not only a toggle.
- **Mobile canvas snaps between sections or spreads.** Desktop keeps free pan and zoom.
- **Two bucket tiers:**
  - *Featured buckets:* a finite set, rotated seasonally. They get the canvas mode, art direction and human image sign-off.
  - *Everything else:* automatic gates and editorial masonry.

  0004's 42 real buckets are the starting population for this split.
- **Pinterest landing:** a single-tour pin goes to the tour page; a collection pin goes to the bucket.
- **Choosing `best`:** the most beautiful image that still honestly shows the tour, never a more attractive but unrepresentative one.
- **Stock (from the prototype):**
  - atmosphere tiles only, never inside a tour tile;
  - credited on the tile;
  - at most 1 per 6 tour tiles;
  - never cropped;
  - clips muted and looping, playing only in view at mid or near zoom, at most 2 at once, and poster-only under reduced motion.
- **Animation is an accent:** `transform` and `opacity` only, restrained on mobile. The library is chosen after the layout is settled.
- **Canvas mode direction:** prototype I (A's spread head plus a masonry tail) with LOD, and G's type-led treatment as a contributor. Confirm after round 3.

## Evidence pending

- **Curation picker labels:**
  - **Reviewers:** Roy covers both buckets; the designer covers Bangkok's 16 tours.
  - **Protocol:** one `best` per tour, and rejects (with a reason) only for clear defects.
  - **What they answer:** the gate spec, and whether reviewer agreement is high enough to automate taste.
  - **Also watch:** the rate at which today's cover image is rejected.
- **Round 3, mobile (390 px):** editorial masonry plus the snap canvas, with curated images, followed by the friends test.
- **Layout compute budget per bucket.** The prototype's semantic-zoom layout took 3 s per call before a fix, so `/architect` must set a budget.
- **Type scale:** likely a mix (poster-size display, editorial elsewhere).
- **Production stock source:** Pexels has paused new API keys, and the prototype stock is hand-picked. Decide only if stock tiles survive round 3.

## Known doc inconsistencies (not fixed here)

- **1 Oct file:** "Still open" still says 60 tiles and 21–60 `sm`, and its prototype rules say "rotation ±1.5°" without "photo only". Its banner overrides both.
- **Spec 0004, tile-design Decision table:** the caption-height row calls 36.8 a "fractional line height". 36.8 is the two-line `md` total; the line height is 18.4. The line-44 arithmetic is correct. Fix this when 0004 is next touched.
- **Clearance figures are three different measurements; never quote them as one number:**
  - 10.61 px: one sample bucket, 60 tiles, Paper data;
  - 8.09 px: the minimum over 0004's 42 real buckets, rendered geometry;
  - 6.4 px: the same buckets, whole tile modelled as rotated.
