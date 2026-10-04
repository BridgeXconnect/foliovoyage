# 0004. Discovery canvas (EP-20)

**Date**: 2026-10-03
**Status**: In Progress

## Summary

The discovery canvas is one big surface you pan around freely, where tours sit at fixed spots grouped by city and category (42 groups, called buckets: 6 cities times 7 categories). It is built from four pieces: a small feed API that serves the buckets, a layout function that places every tile, a tile design, and navigation (minimap, search, shareable links). The layout is a pure function (same input always gives the same output) shared through `@folio/shared`, so tile positions never depend on font metrics or the device. This umbrella holds the world geometry and the contracts the four children share. Each child is a spec you can build from on its own.

## Structure

Each child is a flat file in this directory, written to be built from on its own, with a short inline rationale.

- [0004-canvas-feed-endpoint.md](0004-canvas-feed-endpoint.md): the two read endpoints that serve bucket summaries and one bucket's 50 ranked tiles (scope row 12, BRI-225). Supports the data decisions: ranking in SQL, no migration, no pagination.
- [0004-canvas-layout-rendering.md](0004-canvas-layout-rendering.md): the pure layout function, its property test, the pan and culler engine, the `/discover` page, and the performance spike (scope row 13). Supports the layout and performance decisions.
- [0004-canvas-tile-design.md](0004-canvas-tile-design.md): tile tiers, shapes, caption heights, hover, the exit tile, tokens, and the `design.md` handoff (scope row 15). Supports the tile decisions.
- [0004-canvas-navigation.md](0004-canvas-navigation.md): minimap, bucket search, and the position URL (scope row 14). Supports the position URL decision.

## Requirements

**User stories**:
- As a visitor, I want to pan across a wall of tours grouped by city and category so that I can browse by feel, without typing a search.
- As a visitor, I want to open a tour from its tile and get back to the same spot on the canvas so that browsing does not lose my place.
- As a visitor, I want to jump to a city and category, and to share a link that reopens the same spot, so that I can find and show a region quickly.
- As Roy, I want the canvas to feel smooth on a phone and to log how people use it so that I can judge it as the main top of funnel surface.

**Acceptance criteria** (the umbrella contract; each child holds its own detailed criteria, prefixed `AC-F`, `AC-L`, `AC-T`, `AC-N`):
- **AC-1**: The world geometry in this file (slot, region, and world sizes, the city and category orders) is defined once, in `@folio/shared`, and the layout, the minimap, the search jump, and the position URL all read it from there. No other file hard codes a slot position.
- **AC-2**: A bucket's tiles have the same positions on every device, every load, and every run for the same feed data. Nothing in the layout reads the DOM, fonts, the viewport, or the clock.
- **AC-3**: Only the seven shown categories and the six curated cities appear. Category 21914 (Travel & Transportation Services) and tours with a null primary category never appear in any feed response.
- **AC-4**: `/discover` is `noindex`, absent from the sitemap, and its heavy script loads only on that route.
- **AC-5**: The three analytics events (`canvas_bucket_enter`, `canvas_tile_click`, `canvas_nav_jump`) go through one helper in `apps/web/src/lib/analytics.ts` and never through an inline `posthog.capture`.
- **AC-6**: Every tile and the exit tile link through one swappable function each (`tourHref`, `exitHref`), so BRI-205 and the new tour page can change a target in one place.
- **AC-7**: The canvas runs the performance gate in `0004-canvas-layout-rendering.md` (AC-L9) on a mid range phone before slice 2 starts.
  - The performance spike passed the gate on an iPhone 16 (95th percentile 17 to 18 ms over pan frames in 9 of 13 runs, production build) and confirmed 512 px sections, overscan 1, and the 150 tile cap. The numbers, and what was not measured, are under AC-L9.

## Decision

**Chosen option**: Option 1: A fixed scale world with section culling, fed by a two endpoint API and laid out by a pure shared function.

The decisions inside that option, with the pick, the reason, and the runner up:

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Surface | One fixed scale world, free pan, no zoom, tiles at fixed positions | The design is a wall you wander, and fixed positions make shared links and a minimap exact | A virtual scroll grid (`@tanstack/react-virtual`) |
| Mounting | Section grid culler: 512 px sections, 1 section overscan, at most about 150 mounted tiles | Cheap to compute, predictable, no per tile observers | Per tile `IntersectionObserver` |
| Pan | Hand rolled pointer events, `translate3d`, `requestAnimationFrame`, wheel and arrow keys | No new dependency, full control of the frame budget | A pan and zoom library |
| Tiles per bucket | 50 | One bucket fills a 2400 by 1624 slot with room to breathe, and 50 is small enough to need no paging. At 60 tiles, 14 of the 36 full buckets did not fit the slot (41 of 2,400 tiles dropped, all `sm`); at 50, 0 of 42 fail on the real data | 40, 60 or 100 |
| Rank tiers | Ranks 1 to 4 `lg`, 5 to 20 `md`, 21 to 50 `sm` | Confirmed (the cap moved from 60 to 50 after the fit measurement) in the interview | Fewer, larger tiers |
| Ranking | Bayesian weighted rating, computed in SQL per request and cached | No migration, no stored derived value, results stay fresh | A stored rank column |
| World arrangement | Cities in a 3 by 2 grid, each city a 4 by 2 grid of category slots (7 used, 1 spare) | Regular, so the minimap and the arithmetic are trivial | One long strip of 42 slots |
| Position URL | Bucket relative: `/discover?at=rome.art-culture&dx=120&dy=-40` | Survives any later change to slot size or arrangement | Absolute world pixels |
| Shared layout | `@folio/shared`, consumed by `apps/web` only for now | The api cannot load that ESM package at runtime today | A duplicate copy in the api |
| Tile target | A new `noindex` DB backed tour page, linked through `tourHref` | DB tours have no page today (see Follow-up) | The affiliate link directly |
| Exit tile | An `md` 3:2 tile to the unfiltered city page `/destinations/:slug`, linked through `exitHref` | No category filtered city page exists | Build a filtered page now |
| Build approach | Tracer Bullet: Bangkok first, end to end, then six cities, then tile design | The project default | Layout first, then data |

## Cross child contract

### World geometry (defined once in `@folio/shared`)

| Constant | Value |
|---|---|
| Slot (one bucket) | 2400 by 1624 px |
| City region | 4 columns by 2 rows of slots: 9600 by 3248 px (7 slots used, the eighth stays empty and reserved) |
| World | 3 city columns by 2 city rows: 28,800 by 6,496 px |
| Section size | 512 px, overscan 1 section (at most 52 mounted tiles on a phone and 77 on a desktop, measured in the performance spike) |

Fixed order, so a bucket's position never changes:
- Cities, row by row: `bangkok`, `kyoto`, `hanoi` (top row), `rome`, `lisbon`, `bali` (bottom row). City `i` sits at column `i mod 3`, row `floor(i / 3)`.
- Categories, row by row, 4 per row, the eighth cell spare: `outdoor-activities` (21909), `art-culture` (21910), `food-drink` (21911), `tickets-passes` (21912), `tours-sightseeing` (21913), `classes-workshops` (21915), `seasonal-events` (21916). Category `k` sits at column `k mod 4`, row `floor(k / 4)`.
- A bucket's slot origin is `x = cityCol * 9600 + catCol * 2400`, `y = cityRow * 3248 + catRow * 1624`.
- A bucket's slot centre is its origin plus (1200, 812).
- Names and labels (the geometry constant holds slugs and these labels, the feed carries `cityName` from `City.name`): categories `Outdoor Activities`, `Art & Culture`, `Food & Drink`, `Tickets & Passes`, `Tours, Sightseeing & Cruises`, `Classes & Workshops`, `Seasonal & Special Occasions` (from the comments in `apps/api/src/modules/import/category-rule.ts`). Cities `Bangkok`, `Kyoto`, `Hanoi`, `Rome`, `Lisbon`, `Bali`.
- The six cities are this list, matched to the database on `countrySlug` plus `slug`. A parity test asserts the list equals the slugs in `apps/api/src/modules/import/curated-cities.ts`, so the two cannot drift (the seed also creates Paris, which is not a canvas city).

The city and category orders and the slugs are arrangement proposals for the designer to confirm (listed in the open items). Bangkok is first because the build plan starts there.

### Layout constants (values from the prototype `cluster.mjs`, canvas-Gallery commit `2a132ba`, and `tours-bkk-ac.json`)

| Constant | Value |
|---|---|
| Tier photo width | `lg` 360, `md` 240, `sm` 168 px (3:2 photo height is two thirds of the width, 1:1 equals the width) |
| Tier caption height | `lg` 68, `md` 57, `sm` 14 px |
| Gap between photo and caption | `lg` 12, `md` 10, `sm` 8 px |
| Grid, gutter, margin, clearance | 8, 24, 48, 6 px |
| Jitter, tilt | ±5 px, ±1.5 degrees |
| Title block (reserved, top left) | at (48, 48), 201 by 59 px (the prototype's Bangkok value), kept as a fixed reservation so the layout does not depend on font metrics. The designer may change it in `tiers.ts` |
| Exit tile | 240 by 160 px (`md` 3:2), no caption (its copy sits inside the tile), corner at (2112, 1416), which is the slot size minus the 48 px margin minus the tile size |

### Client fetch path

The client cannot call the api directly (`API_BASE_URL` is server only and the api has no CORS). `apps/web` adds a route handler at `/api/canvas/buckets/[city]/[cat]` that proxies the api bucket endpoint and passes the cache headers through. CORS stays off.

### Shared types

The wire types for the feed live in `packages/shared/src/api.ts` as Zod schemas (additive, api first, web second). The layout types and the pure functions live in `packages/shared/src/canvas/` with zero imports and no Node or DOM API.

### Analytics events

| Event | When | Properties |
|---|---|---|
| `canvas_bucket_enter` | The view's centre moves into a bucket slot and stays 600 ms | `city`, `category` (slugs), `source` (`pan`, `minimap`, `search`, `link`) |
| `canvas_tile_click` | A tile or the exit tile is activated | `city`, `category` (slugs), `rank` (`null` for the exit tile), `tier`, `tile_kind` (`tour` or `exit`), `experience_id` and `tour_id` (`null` for the exit tile) |
| `canvas_nav_jump` | The minimap or search moves the view | `from_bucket`, `to_bucket` (both `city.category` slugs), `method` (`minimap` or `search`) |

The helpers are `trackCanvasBucketEnter`, `trackCanvasTileClick`, and `trackCanvasNavJump`.

## Build plan

Ordered through Tracer Bullet: one city goes end to end first. Child tasks are listed in each child file; this is the umbrella order.

Slice 1, thin thread, Bangkok:
1. Add the world geometry, layout constants, category map, and feed Zod types to `@folio/shared`, with a geometry test and the curated city parity test, satisfies **AC-1**, **AC-3**
2. Feed endpoint (child F), satisfies **AC-3**
3. Layout function and its property test (child L), satisfies **AC-1**, **AC-2**
4. Performance spike: culler and pan with synthetic tiles on a phone, which also confirms or changes the 512 px section size and the 150 tile cap (child L), satisfies **AC-7**
5. `/discover` page with Bangkok's seven buckets, pan, culler, and the bucket proxy route, with a test that the sitemap and robots output exclude it and that no other route imports the engine (child L), satisfies **AC-4**
6. Tile click through `tourHref` and the three analytics helpers, including `canvas_bucket_enter` (child L), satisfies **AC-5**, **AC-6**

Slice 2, all six cities:
7. Fetch all six cities, mobile and performance pass as the gate (child L), satisfies **AC-7**
8. Minimap, search, position URL (child N), satisfies **AC-1**, **AC-5**

Slice 3, tile design:
9. Tokens, tiers, hover, exit tile, `design.md` (child T), satisfies **AC-6**

## Consequences

**Positive**:
- Positions are deterministic, so tests, shared links, and later share cards all agree.
- No schema change and no new service.
- The feed is small and cacheable, and the client never loads more than the buckets near the view.

**Negative / tradeoffs**:
- A hand rolled pan is more code than a library, and gestures on a phone need real testing.
- The 50 tile cap means a visitor sees the best 50 of a bucket only. The exit tile promises a count and category the target page does not show (see Follow-up).
- Clearance was tested on one bucket only. The property test closes that gap but the layout rules may still need tuning.
- Ranking in SQL on every request costs a query per bucket, held down by caching.
- Ranks can change when the 10 minute cache refreshes, which re flows a bucket. A shared link's `dx` and `dy` may then land near different tiles. This is accepted.

**Neutral**:
- The new tour page is a separate piece of work outside these four features.
- The layout is web only for now. The api cannot call it until a later change to the shared package build.

## Follow-up

- [x] Enrol a scope row and write a spec for the new DB backed tour page (spec 0005). A tile click now opens that tour's page: `tourHref` points at `/tours/:experienceId`.
- [ ] Designer decision: the exit tile copy ("All N in {City} · {Category}") promises a category and count the unfiltered city page does not show. Change the copy or add a filtered view (BRI-205 may cover it).
- [ ] Designer decision: the 9 search result row separators on `line-strong` are an unreviewed judgment call.
- [ ] Designer decision: confirm the city order, category order, and category labels in the world geometry above.
- [ ] Rank 1 sits to the right of the title block (recommended), 24 px from it and exempt from the placement scoring. It is not in the prototype `cluster.mjs`, so add it to the layout function and its property test.
- [ ] Update BRI-225: its text is stale (cursor pagination, price band, real image width and height).
- [ ] When share cards need the layout on the server, give `@folio/shared` a dual build or a CommonJS entry so the api can call it.
- [ ] Confirm the BRI-224 backfill ran against production, so `primaryCategoryTagId` is set on live tours. This spec did not verify it.
- [ ] The category slug and label map has an API local copy (`apps/api/src/canvas/canvas-categories.ts`), pinned to the shared copy and to `category-rule.ts` by a parity test, because the API compiles to CommonJS and cannot import values from `@folio/shared` yet. AC-1's "defined once" applies to slot geometry, which only `@folio/shared` holds. Remove the copy when `@folio/shared` gets a dual build or a CommonJS entry.
- [ ] Add the Paper caption, leading, and panel tokens to `apps/web/src/app/globals.css`, scoped to the canvas root (details in the tile design child).

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
