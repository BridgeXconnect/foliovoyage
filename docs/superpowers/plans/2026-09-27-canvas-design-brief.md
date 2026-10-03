# Discovery canvas: design brief for `/scope` and `/architect`

**Date:** 2026-09-27 · **Epic:** EP-20 (BRI-223) · **Owner:** Roy
**Save to:** `docs/superpowers/plans/2026-09-27-canvas-design-brief.md` (commit it with the spec PR so the spec's `rationale.md` can cite it)

## How to use this

1. **`/scope`**: enroll the canvas as its own epic. `docs/scope/_root/scope.md` already holds 13 rows across unrelated areas, so let `/scope` promote it to the epic split (`index.md` + one file per area) now, with the canvas in its own file. Enroll these features, all tagged `· Beta` (project default is Alpha; this is the main discovery surface):
   - Canvas feed endpoint (BRI-225), needs a decision
   - Canvas layout and rendering (region layout, culler, pan), needs a decision
   - Canvas navigation (minimap, bucket search, shareable position URLs)
   - Canvas tile design (tile shape rules, hover caption, visual direction), needs a decision
2. **`/architect discovery canvas`**: one umbrella spec (directory shape), with child specs for the feed endpoint, layout and rendering, and tile design. Give it this file as the design input. Everything under **Decided** is settled, so don't re-ask it. Everything under **Recommended** is my call with reasoning: confirm or override. Only the items under **Ask Roy** genuinely need your judgment in the interview.

Build approach: **Tracer Bullet** (project default). See the build plan seed at the end.

---

## What the canvas is

A Pinterest-style discovery surface that pans freely in every direction. Tours sit at fixed positions, clustered by taxonomy: city regions, subdivided into category regions. It's top-of-funnel and emotional ("not planning a trip" → "might be"), not exhaustive search. The written pages (hubs, detail pages) are the exhaustive, indexable layer. The canvas isn't indexed and is free to be visually expensive.

Source vision: `docs/superpowers/plans/2026-09-25-canvas-pinterest-combinatorial-content-vision.md` §2 and §8.5.

## Decided (don't re-ask)

- **Taxonomy, not geography.** No lat/lng anywhere in placement. (The map, EP-7, is deprioritized; BRI-131 is parked.)
- **Fixed scale, free pan.** No Google-Maps-style or deep zoom. A gentle zoom (~0.7×–1.2×) may be tried later; it isn't in this spec. Consequence: the minimap and search are the *required* ways to travel between regions, not extras.
- **Rendering technique:** positioned tiles inside one transformed "world" element, plus a **section-grid culler**. The world is split into fixed-size sections, each tile is filed under the sections it overlaps, and only tiles in sections the viewport touches are mounted. This is the technique behind `react-virtualized`'s deprecated `Collection`.
  - **Not `@tanstack/react-virtual`.** It's axis-based (lists, grids, lane masonry) and computes positions itself, so it can't take assigned x/y. Checked against its docs.
- **Server serves items per taxonomy bucket.** Culling is client-side over computed canvas coordinates, so there's no spatial/bbox query.
- **Buckets = city × primary category.** The primary category is `Tour.primaryCategoryTagId` from BRI-224 ("rarest root wins" over Viator's 8 current category roots).
- **Excluded from the canvas:** Travel & Transportation Services (21914: airport transfers, private drivers) and tours with a null primary category (untagged pre-14-Sep rows, until BRI-227 re-fetches them). Both are feed-level rules; the data stays in the DB.
- **Reference prototype:** `~/dev/canvas-Gallery` (Figma Make export). Keep its data model (`x, y, width, height` per item, absolutely positioned) and its "drag the world" idea. Don't port its code: 12 hardcoded items, no culling, framer-motion, MUI/Radix scaffolding.
- **Workflow tier:** Beta (`/check verify` + `/test`).

## Facts checked today (prod + repo, 2026-09-27)

**Bucket sizes.** 6 cities × 7 canvas categories = 42 buckets. Canvas-eligible today ≈ 16.4K tours, rising toward ~26K after BRI-227. The spread is huge:

| City | Outdoor | Art & Culture | Food & Drink | Tickets & Passes | Tours & Sightseeing | Classes | Seasonal | Total |
|---|---|---|---|---|---|---|---|---|
| Hanoi | 2,313 | 433 | 292 | 1,457 | 250 | 52 | 69 | 4,866 |
| Rome | 373 | 2,344 | 292 | 371 | 163 | 200 | 277 | 4,020 |
| Bali | 1,361 | 803 | 85 | 519 | 461 | 99 | 68 | 3,396 |
| Lisbon | 241 | 1,255 | 168 | 79 | 223 | 67 | 258 | 2,291 |
| Bangkok | 165 | 412 | 207 | 175 | 96 | 30 | 50 | 1,135 |
| Kyoto | 97 | 270 | 92 | 30 | 32 | 159 | 43 | 723 |

**Images: this changes the tile design.** Checked across all 9,876 tours that have a gallery:
- Every cover comes as the **same 10 fixed crops**: 75², 100², 200², 400² (1:1); 360×240, 480×320, 540×360, 720×480 (3:2); 674×446 (~3:2); 210×118 (16:9, small).
- **No portrait crop exists, and nothing is larger than 720×480.** The photo's native shape is not available at all.
- 20.5K tours have no gallery, only `Tour.imageUrl`, which is the 540×360 crop. Every published tour has one (100% cover coverage).
- The URL embeds the size (`...splice-spp-540x360/...`). Don't construct other sizes by rewriting it. Use only variants present in `images`, else `imageUrl`.

**Other fields.** Price (reference USD) 100% · duration 76% · rating 54%. `aiSummary` exists only where BRI-154 has published copy.

**Web app.** Next.js 15, React 19, Tailwind 4, `@folio/shared` (shared wire types, BRI-214 done), `posthog-js` present. **No framer-motion, and no `design.md` anywhere in the repo.** Brand voice lives in `docs/08-brand-voice-style-guide.md`. Tour detail pages exist (BRI-129).

## Recommended (confirm or override in the interview)

1. **Cap tiles per bucket and rank them. Don't render the whole catalogue.**
   - **Why:** 2,344 Rome Art & Culture tiles is a database dump, and §2.3 explicitly wants the canvas to read as curated. The written layer already covers exhaustive listing.
   - **How:** each bucket shows its top **N** (recommend **N = 60**), plus an exit tile, "All 2,344 in Rome · Art & Culture →", pointing to the written city/category page.
   - **Ranking:** a Bayesian-weighted rating (`ratingAvg`/`ratingCount` shrunk toward the bucket mean), then a stable tie-break on id. Tours without a rating rank after rated ones, never hidden.
   - **Later:** BRI-228's Viator quality flags could refine ranking once their meanings are confirmed. Not in this spec.
   - **Knock-on effect:** with N ≤ 60, one request returns a whole bucket, so **BRI-225 drops cursor pagination**. Update the ticket if confirmed.

2. **Fixed-size bucket slots, so every position is stable.**
   - Because every bucket is capped at N, every bucket's slot can be the same size. Cities form a fixed arrangement (recommend a 3×2 grid of city regions, in a fixed city order). Each city region holds its 7 category slots in a fixed category order.
   - Slot origins then **never move** when catalogue counts change. That's what makes shared position URLs safe without persisting any per-tile positions.
   - Small buckets (e.g. Bangkok Classes, 30 tiles) fill their slot less densely. That's fine, and honest.

3. **Layout is a pure function in `@folio/shared`.** Signature: `(bucket list, per-bucket ranked item list) → positioned tiles`.
   - Within a slot: deterministic, seeded jittered placement. Seed it from the stable Experience id so a tile keeps its spot while the bucket's membership holds. Allow slight overlap and small rotations, per §2.3. Keep it readable, not chaotic.
   - **Why shared and pure:** unit-testable without a browser, and the server can compute the same positions later (e.g. share-card images) without drift.

4. **No new animation dependency for pan.** Use pointer events + `transform: translate3d` on the world element + `requestAnimationFrame`, with optional light momentum. Wheel/trackpad = pan (there's no zoom to conflict with). Arrow keys pan for keyboard users.
   - **Why:** the culler must read the exact offset every frame. A hand-rolled 60-line pan gives it that directly. framer-motion's drag would add a dependency and a second source of truth for position.

5. **Culler numbers.**
   - Sections of ~1,024 world px, with 1 section of overscan.
   - Mount only tiles in touched sections, aiming for ≲150 mounted tiles.
   - Images load only for mounted tiles (`decoding="async"`).
   - Target 60 fps pan on a mid-range phone.

6. **Data flow.**
   - The server fetches bucket summaries (42 rows, tiny) for first paint.
   - The client computes the layout, then fetches a bucket's items when its slot comes within ~1 viewport of the screen. Results are cached in memory for the session.
   - The summaries carry what the minimap and search need (label, count, representative image).

7. **Tile click → the tour's own detail page** (BRI-129), not straight to the affiliate link.
   - **Why:** it keeps `/go` click logging and internal linking, and matches §2.7's "organic hover → own detail page".

8. **Navigation v1.**
   - A minimap HUD showing the 6 city regions and their category slots; click to fly there.
   - Search jumps to a bucket by city or category name, client-side over the 42 labels. Full-text tour search (the existing `/search` API) is a later slice.
   - Position lives in the URL relative to a bucket origin, e.g. `/discover?at=rome.art-culture&dx=…&dy=…`, so shared links survive layout changes elsewhere.

9. **Route and indexing.** A new `/discover` route. `noindex`, kept out of the sitemap, and heavy JS confined to this route so indexable pages keep their Core Web Vitals (§1).

10. **Mobile is first-class, not a later pass.** Pinterest traffic is overwhelmingly mobile, and the canvas's main acquisition channel is Pinterest. Touch pan, tile sizes, and the minimap all need a phone-first design from slice 1.

11. **Minimal analytics from day one** via the existing PostHog: `canvas_bucket_enter`, `canvas_tile_click`, `canvas_nav_jump`. It's cheap, and it seeds the behavioural-data moat (vision §5) instead of starting it later from zero.

## Tile shape rules (a design constraint from the image facts)

Photos only offer **1:1 and 3:2** at usable sizes, so meaning has to come from **size and crop choice, not native shape**. Recommend:

- **Three tile sizes**, driven by rank within the bucket: the top few large, the next band medium, the rest small.
- **Aspect by type:** 3:2 for full-day, multi-day and water/cruise tours; 1:1 for short (<3 h) and food experiences; 3:2 when duration is unknown (24% of tours).
- **Size ceiling:** keep the largest photo tile ≤ ~360 CSS px wide. The largest source is 720 px wide, and only 540 px for gallery-less tours, so anything bigger blurs on 2× screens.
- **Portrait tiles** (§2.3's "tall trek" idea) aren't possible with real photos. They'd need a destructive crop of a landscape shot. Reserve tall shapes for later non-photo tiles (pull-quote, stat) instead.

## Ask Roy (genuinely your call)

1. **Visual direction** (this becomes `design.md`, which `/develop`'s UI track requires). The prototype is a dark gallery. §2.3 describes an "infinite HTML newspaper": paper texture, serif display type, polaroid/torn-edge treatments. **Recommendation: the newspaper direction.** It's the documented intent, it's distinctive in travel, and it matches the brand voice in `docs/08`. But it's a taste decision.
2. **N per bucket.** Recommend 60. Higher means more to browse but more pan distance and more near-duplicates.
3. **Should the exit tile** ("All N in … →") point at a written page that already exists today? If the city/category hub pages (BRI-205) aren't built yet, the fallback is the existing city page filtered by category.

## Out of scope for this spec

Zoom; the seasonal time scrubber; ambient presence; sponsored tiles and territory ads; save/boards/itinerary widget; Pinterest pins and deep links; editorial non-photo tiles (pull-quote, stat, gutter text); vision grounding; hover desaturation. Each is a later slice or its own spec.

## Build plan seed (Tracer Bullet)

1. **Thin thread, one city:**
   - BRI-225 summaries + bucket-items endpoints, with feed rules and ranking.
   - The pure layout function in `@folio/shared` (tested).
   - `/discover` rendering Bangkok's buckets with the culler and hand-rolled pan.
   - Tile click → detail page.
   - Placeholder styling until the design pass.
2. **All six cities:** the full world layout, the minimap, bucket search, and URL position state.
3. **Tile design:** `design.md` applied, tile size/shape rules, hover caption (`aiSummary` or title), and PostHog events.
4. **Mobile and performance pass** against the targets above (60 fps pan, ≲150 mounted tiles).

**Dependencies:** BRI-224 merged, and its prod backfill run, before slice 1 uses real data. BRI-227 raises coverage but doesn't block. BRI-129 detail pages exist.

## Corrections to carry into the vision doc (next docs PR)

§8.5 names `@tanstack/react-virtual` as `Collection`'s replacement: wrong, see Decided. Zoom-as-hierarchy (§2.2) is dropped. The aspect-ratio idea (§2.3) is constrained by the fixed image crops above.
