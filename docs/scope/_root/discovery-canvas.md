# Scope: discovery canvas (EP-20, BRI-223)

A Pinterest style discovery surface that pans freely in every direction, with tours at fixed positions clustered by city and category. It is the main top of funnel discovery surface, so its features run at the Beta tier (the project default is Alpha). Design input: [the canvas design brief](../../superpowers/plans/2026-09-27-canvas-design-brief.md). Decisions made since: [the canvas design decisions](../../superpowers/plans/2026-10-01-canvas-design-decisions.md). What it lists under Decided is settled; `/architect` should confirm or override only what it lists under Recommended and Ask Roy. See the legend in [index.md](index.md#legend) for the status words and the feature lifecycle.

## Slice 1: thin thread, one city

### 12. Canvas feed endpoint (BRI-225) · in-progress · Beta
The server feed the canvas reads: a small summary of every city and category bucket for first paint, and one bucket's ranked tours on request. It applies the feed rules (no Travel & Transportation Services, no tours without a primary category) and ranks each bucket.
**Done when:** the feed serves bucket summaries and a bucket's tours for the six cities, the exclusion and ranking rules apply, and a bucket loads without paging through the whole catalogue.
- [x] Design it (spec): [0004 feed endpoint](../../specs/_root/0004-discovery-canvas/0004-canvas-feed-endpoint.md), umbrella [0004](../../specs/_root/0004-discovery-canvas/index.md)
- [ ] Build it: `/develop canvas feed endpoint`
  - [ ] Category map, world geometry, and feed Zod types in `@folio/shared` (AC-F6, AC-F9)
  - [ ] Bucket and summaries queries with Bayesian rank and image pick (AC-F3, AC-F4, AC-F5, AC-F7, AC-F10)
  - [ ] Controller, 404 problem responses, cache headers and in process cache (AC-F1, AC-F2, AC-F8)
  - [ ] Integration tests against the seeded database (AC-F3 to AC-F5)
- [ ] Verify it: `/check verify`
- [ ] Test it: `/test`

### 13. Canvas layout and rendering (region layout, culler, pan) · in-progress · Beta
A pure layout that gives every tile a stable position inside its city and category region, and a discovery page that pans freely and mounts only the tiles near the viewport. Bangkok first, then all six cities.
**Done when:** a discovery page shows Bangkok's buckets with free pan and only nearby tiles mounted, and a tile click opens that tour's own page.
- [x] Design it (spec): [0004 layout and rendering](../../specs/_root/0004-discovery-canvas/0004-canvas-layout-rendering.md), umbrella [0004](../../specs/_root/0004-discovery-canvas/index.md)
- [ ] Build it: `/develop canvas layout and rendering`
  - [ ] Pure `layoutBucket`, tier constants, seeded shape, and the property test (AC-L1 to AC-L6)
  - [x] Performance spike on synthetic tiles, then the production pan and culler engine (AC-L7 to AC-L9, AC-L15)
  - [x] `/discover` page, bucket proxy route, fetch and cache, Bangkok's seven slots (AC-L10, AC-L12, AC-L14, AC-L16)
  - [x] Tile links, keyboard handling, and the click and bucket enter events (AC-L11, AC-L13)
  - [ ] All six cities and the mobile and performance gate (AC-L9, AC-L14)
- [ ] Verify it: `/check verify`
- [ ] Test it: `/test`

## Slice 2: all six cities

### 14. Canvas navigation (minimap, bucket search, shareable position URLs) · in-progress · Beta
Ways to travel between regions on a canvas that pans but does not zoom: a minimap, a search that jumps to a bucket, and a position kept in the page address so a shared link reopens the same spot.
**Done when:** picking a region on the minimap or a result in the search moves the view to that bucket, and a copied link reopens the same position.
- [x] Design it (spec): [0004 navigation](../../specs/_root/0004-discovery-canvas/0004-canvas-navigation.md), umbrella [0004](../../specs/_root/0004-discovery-canvas/index.md)
- [ ] Build it: `/develop canvas navigation`
  - [ ] Position URL read and write with fallbacks (AC-N4, AC-N5)
  - [ ] Minimap and jump (AC-N1, AC-N3)
  - [ ] Client search (AC-N2, AC-N7)
  - [ ] Desktop chrome, mobile sheet, keyboard and focus, and the jump event (AC-N6, AC-N8, AC-N9)
- [ ] Verify it: `/check verify`
- [ ] Test it: `/test`

## Slice 3: tile design

### 15. Canvas tile design (tile shape rules, hover caption, visual direction) · in-progress · Beta
How a tile looks: size and shape rules that work within the photo crops the provider offers, a hover caption, and the visual direction, which becomes `design.md`.
**Done when:** `design.md` is written and tiles follow its size and shape rules, with a hover caption.
- [x] Design it (spec): [0004 tile design](../../specs/_root/0004-discovery-canvas/0004-canvas-tile-design.md), umbrella [0004](../../specs/_root/0004-discovery-canvas/index.md)
- [ ] Build it: `/develop canvas tile design`
  - [ ] Caption, leading, and panel tokens scoped to the canvas root, with the parity test (AC-T3, AC-T4)
  - [ ] Tile component with three tiers, fixed caption heights, and clamps (AC-T1, AC-T2, AC-T8, AC-T10)
  - [ ] Hover and focus states and the exit tile (AC-T5, AC-T6)
  - [ ] Swap test and the designer's `design.md` (AC-T7, AC-T9)
- [ ] Verify it: `/check verify`
- [ ] Test it: `/test`

## Follow-ups from spec 0004

### 16. New database backed tour page for canvas tiles (from spec 0004) · in-progress · Beta
Canvas tiles for tours that live only in the database have no page to open today (the only tour page and the `/go` redirect serve hand authored static content). This is a new `noindex` page linked through `tourHref`.
**Done when:** a canvas tile for a database only tour opens a page with the tour's details and a tracked affiliate link.
- [x] Design it (spec): [0005](../../specs/_root/0005-database-tour-page/index.md)
- [ ] Build it: `/develop database tour page`
  - [ ] Shared Zod schemas and the api page data and rating endpoints, with the 404 cases and cache headers (AC-1, AC-2, AC-3, AC-5)
  - [ ] The ISR page, its 404, and the `/go/tours` click redirect with fallback and ledger timeout (AC-4, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-15)
  - [ ] Protected rating path: blocked script, JSON proxy, robots rule, View Source test (AC-2, AC-6)
  - [ ] Back link and analytics events (AC-13, AC-14)
  - [ ] Switch `tourHref` once the canvas rating leak is fixed, then the iPhone 16 check (AC-16, AC-17)
- [ ] Verify it: `/check verify database tour page`
- [ ] Test it: `/test database tour page`

### 17. Keep the canvas rating out of unblocked responses (from spec 0005) · planned · needs a decision · Beta
The canvas JSON route (`/api/canvas/buckets/...`) sends `ratingAvg` and `ratingCount` on a path `robots.txt` does not block, and large tiles render the rating. Viator treats the rating as protected content (BRI-204 reply, 2026-09-21), so it must load from a robots blocked path or not show on tiles. This blocks the `tourHref` switch in row 16.
**Done when:** no canvas response on an unblocked path carries a rating, and any rating the canvas shows loads through the `/protected/` path.
- [ ] Design it (spec): `/architect canvas rating protected content`
