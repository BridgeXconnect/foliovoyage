# 0004. Canvas layout and rendering (child of 0004 discovery canvas)

Scope row 13. Governed by [index.md](index.md): the world geometry, tile tiers, and analytics events are defined there and in the tile design child.

## Summary

A pure function places every tile of a bucket inside its slot, the same way every time. A page at `/discover` holds all slots in one moving "world" element, pans it with pointer events, and mounts only the 512 px sections near the view. The work starts with a performance spike on a phone, because the whole design stands or falls on the pan holding about 60 frames per second. Bangkok goes first, then all six cities.

## Requirements

**User stories**:
- As a visitor, I want to drag, scroll, or use the arrow keys to move across the wall smoothly so that browsing feels fluid, also on my phone.
- As a visitor, I want a tile to open its tour so that I can find out more.
- As a developer, I want tile positions to come from a tested pure function so that they never overlap and never change between loads.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-L1**: `layoutBucket` is a pure function in `packages/shared/src/canvas/`, with no imports except the constants in `geometry.ts` and no Node or DOM API. Given the same `bucketKey` and tile list it returns the same placements, byte for byte.
- **AC-L2**: Each tile's shape (1:1 or 3:2) and its jitter and tilt are seeded from its tile id (the Experience id) with FNV-1a (32 bit) hashing into a mulberry32 generator. A tile is 1:1 when `hash % 100 < 30`. Jitter is within ±5 px and rotation within ±1.5 degrees.
- **AC-L3**: Placement follows the prototype rules: rank order, the first free spot on an 8 px grid, scored by `y + 0.55 * x`, a 24 px gutter, a 48 px margin, the title block and the exit tile corner reserved first, and a minimum clearance of 6 px between tilted outlines. The outline includes the caption. A placement's `x` and `y` are the pre rotation top left corner. All constants (tier widths, title block, exit tile) are in index.md.
- **AC-L4**: Every tile is placed fully inside its 2400 by 1624 slot, with caption height taken from the fixed tier tokens (14, 57, 68 px) and never measured.
- **AC-L5**: The layout never throws and never grows the slot. A tile that cannot be placed is left out and its id is listed in `dropped`, in rank order. Tests, all with fixed seed lists so a failure can be rebuilt:
  - A property test over at least 200 buckets with tile counts from 1 to 50 (small buckets included) and 1:1 shares from none to 40%, plus 500 seeds at 50 tiles for each share (0, 10, 20, 30 and 40%). For each it asserts: nothing is `dropped`, minimum clearance at least 6 px, every tile inside the slot, no overlap with the title block or the exit tile, determinism (two runs equal), and that placed plus dropped equals the input count.
  - The 42 real buckets (a committed fixture of tile ids in rank order, capped at 50): nothing is `dropped`, and the same clearance, slot and overlap checks pass.
  - A 50% stress test, over 500 seeds at 50 tiles with 50% of them 1:1, that does **not** require zero drops. It asserts at most one dropped tile per run, that the dropped id is one of the last two ranks, that the function returns, the same clearance, slot and overlap checks, and determinism. The measured limit is recorded under Consequences.
  - An over-full test (50 tiles, all 1:1): the function returns, `dropped` is a contiguous tail of ranks in rank order, nothing overlaps, and two runs are equal.
- **AC-L6**: The exit tile is 240 by 160 px with no caption, placed in the reserved corner (2112, 1416). Rank 1 sits to the right of the title block, 24 px from it, and is exempt from the placement scoring. The tile count never exceeds 50 plus the exit tile. If rank 1 does not fit beside the title block, it is placed by the normal scan.
- **AC-L7**: `/discover` mounts only tiles in sections inside the viewport plus one section of overscan, never more than about 150 tiles at a time (the spike measured at most 52 on a phone and 77 on a desktop), and moves the world with a `translate3d` transform driven by `requestAnimationFrame`.
- **AC-L8**: Pan works with pointer drag (mouse and touch), the wheel and trackpad, and the arrow keys. A drag longer than 6 px suppresses the click on the tile under the pointer, so a pan that starts on a tile never opens it. Touch and pointer drags follow the finger 1:1 and glide on release with time based exponential decay (τ default 325 ms, stop below 8 px/s, release velocity capped at 4,000 px/s, from the last ~100 ms of samples). A touch during a glide stops it, and its click is swallowed. Discrete wheels and the arrow keys ease, trackpads move the view directly. `prefers-reduced-motion` turns off the glide and every ease. The view clamps to the world bounds. Page scroll and pull to refresh do not fight the pan (`touch-action: none` on the canvas only).
- **AC-L9**: Performance gate: a scripted pan across four adjacent slots, with Chrome's 4x CPU throttling, keeps the 95th percentile frame time at or under 20 ms and mounted tiles at or under 150. It is also checked by hand on one real mid range phone before slice 2.
  - Outcome of the spike (BRI-223, PR #109): passed on an iPhone 16 (Low Power Mode off, Chrome on iOS, which is WebKit) with a production build, panned by hand for about 20 s per run. Only pan frames count, from a pan's first input to 300 ms after its last, so idle frames cannot dilute the numbers. The 95th percentile was 17 to 18 ms in 9 of 13 runs, every baseline run among them. It was 20 ms in 1 run and 21 ms in 3, all diagnostic runs that switched something off (`img=off`, `img=1x`, `layers=0`, `decode=pre`). The worst frames were 35 to 48 ms. In the 6 runs that recorded it, 0.6 to 1.7% of frames took over 25 ms. It was not measured on a slow Android phone.
  - The spike confirms 512 px sections, overscan 1, and the 150 tile cap, which stays as a guard only. Two alternatives were tested on the phone and gave no benefit: mounting at most 4 tiles per frame outside React, and 256 px sections with overscan 2.
  - Result for the real page (PR #111): on the iPhone 16 (production build, live feed, Low Power Mode off) the scripted pan gives a 95th percentile of 18 ms, with 0.6 to 0.8% of frames over 25 ms; a hand pan gives 19 ms, with 2.2% over 25 ms. At most 88 tiles are mounted, where the pan crosses into the second row of slots. This is with the photo only tilt (tile design child): with the whole tile rotated, caption included, the scripted pan gave 26 ms and 5.0% over 25 ms, and the 4x throttled Chrome harness passed either way, so the real device runs decided it.
  - Measured clearance with the rendered geometry (each photo a rotated rectangle, each caption an upright one, plus the title blocks and exit tiles): no pair under 6 px across the 42 real buckets, minimum 8.09 px. `apps/web/src/canvas/clearance.spec.ts` checks it.
- **AC-L10**: The server fetches the bucket summaries (up to 42) for first paint, and a slot with no tiles yet shows a placeholder with the summary's representative `image` and the title block. The client fetches a bucket's tiles through the web proxy route (see index.md) when its slot comes within one viewport of the visible area (the viewport expanded by 1× on each side), caches it in memory, and never fetches the same bucket twice in a session. A failed fetch leaves the slot's placeholder and retries on the next move into range.
- **AC-L11**: A tile is a real link (`<a href={tourHref(tile)}>`), reachable by keyboard, and activating it fires `canvas_tile_click`. Tab moves through the current bucket's mounted tiles in rank order, then the jump controls, so keyboard users reach other buckets through the minimap and search. Focus moving to an off screen tile pans the view to keep it visible. With `prefers-reduced-motion` all animated moves are instant.
- **AC-L12**: `/discover` is `noindex`, left out of the sitemap, and its pan, culler, and tile code load only on that route.
- **AC-L13**: `tourHref(tile)` and `exitHref(city)` are the only places that build a tile's target. `exitHref` returns `/destinations/:slug`. `tourHref` returns `/tours/:experienceId?from=:citySlug.:categorySlug` (spec 0005, AC-16); a tile with no Experience id throws.
- **AC-L14**: Mobile first: the first slice is built and checked at phone width before desktop polish.
- **AC-L15**: The world element is a zero size transformed container whose children are absolutely positioned, with no background and no `will-change` on a large box, so it never allocates a 28,800 px layer.
- **AC-L16**: The client bucket fetch goes through the route handler `/api/canvas/buckets/[city]/[cat]` in `apps/web`, which proxies the api and passes the cache headers through. CORS is not enabled on the api.

## Decision

**Chosen option**: Option 1: A pure shared layout, a hand rolled pan, and a section grid culler.

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Layout home | `packages/shared/src/canvas/`, used by `apps/web` only | Pure and testable, and ready for the api later | A copy inside `apps/web` |
| Layout seed | Tile id (Experience id) | Stable across feed changes that shift ranks | Rank |
| Shape | Seeded, about 30% 1:1 | Replaces the old duration based rule, and keeps every bucket varied | By category |
| Culler | 512 px sections, 1 section overscan | Visible sections are arithmetic, no per tile observers | `IntersectionObserver` |
| Pan | Pointer events, `translate3d`, `requestAnimationFrame` | No new dependency | A pan and zoom library |
| Inertia | Release inertia (added after the spike): touch and pointer drags follow 1:1, then glide on release with time based exponential decay (τ default 325 ms, stop below 8 px/s, release velocity capped at 4,000 px/s, measured from the last ~100 ms of samples). A touch during a glide stops it and its click is swallowed. Discrete wheels ease, trackpads are direct, arrow keys ease. `prefers-reduced-motion` disables all of it. τ, the sample window and the velocity cap are tunable in perf mode | Chosen for the Slice 1 build after the spike, so the pan does not feel dead on a phone | None in v1 |
| Fetch policy | Bucket on approach, in memory cache | Bounded requests, no repeat fetches | Prefetch every bucket |

## Feature design

**Data model sketch**: no database change. Types in `@folio/shared`:
- `LayoutInput { bucketKey: string; tiles: { id: string; rank: number }[] }`
- `Placement { id: string; kind: "tour" | "exit"; tier: "lg" | "md" | "sm"; shape: "1:1" | "3:2"; x: number; y: number; w: number; h: number; rot: number }`, with `x` and `y` relative to the slot origin
- `LayoutResult { title: Rect; tiles: Placement[]; exit: Placement; dropped: string[] }`, where `dropped` holds the ids of tiles that did not fit, in rank order, and is empty for every real bucket
- Tier sizes, gaps, the title block, and the exit tile are constants in `packages/shared/src/canvas/tiers.ts`, with the values in index.md (from the prototype `cluster.mjs`, canvas-Gallery commit `2a132ba`).

**State transitions**: a bucket in the client is `idle` (not near), `loading`, `ready`, or `failed`. `idle` moves to `loading` on approach, `loading` to `ready` or `failed`, and `failed` back to `loading` on the next approach.

**API surface**: none new. The page calls the feed endpoints from `0004-canvas-feed-endpoint.md`.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Layout | slot origin | world geometry in index.md, from the city and category indexes |
| Layout | tier | tile `rank` (1 to 4 `lg`, 5 to 20 `md`, 21 to 50 `sm`) |
| Layout | shape, jitter, tilt | hash of the tile id (AC-L2) |
| Layout | caption height | fixed tier token: 14, 57, 68 px (tile design child) |
| Layout | title block and exit corner | constants in index.md |
| Layout | photo width and height | tier size constant and shape, not the source image |
| Culler | visible sections | view offset, viewport size, 512 px section size, overscan 1 |
| Page | tile link | `tourHref(tile)`: the tour page `/tours/:experienceId`, with the bucket key as `from` |
| Page | exit link | `exitHref(city)` |
| Page | title block text | bucket summary `categoryLabel`, `cityName`, `total` |

**Key invariants**:
- No placement leaves its slot, and no two tilted outlines are closer than 6 px.
- The layout reads no DOM, font, clock, or random source.
- Mounted tiles stay at or under about 150.

**Security model**: public, no user data, no auth. `/discover` is `noindex`. It sits behind the existing site password gate while that gate is on.

**Configuration required**: none.

**Critical test scenarios**:
- Property: the function passes AC-L5 over 200 buckets and seeds, verifies **AC-L1**, **AC-L3**, **AC-L4**, **AC-L5**
- Drag: a drag that starts on a tile pans and does not open it, verifies **AC-L8**
- Happy path: Bangkok loads, the view pans by drag, wheel, and keys, and a tile click opens `tourHref`, verifies **AC-L8**, **AC-L11**, **AC-L13**
- Culling: after panning the length of the world, mounted tiles never exceed 150, verifies **AC-L7**, **AC-L9**
- Failure case: a failing bucket fetch leaves a placeholder and retries on the next approach, verifies **AC-L10**
- Auth/permission: the page carries `noindex` and is not in the sitemap, verifies **AC-L12**

## Build plan

Slice 1 (Bangkok):
1. Layout function, tier constants, seeded shape, and the property test, satisfies **AC-L1** to **AC-L6**
2. Performance spike: a throwaway page with synthetic tiles for a few slots, the culler and pan engine, measured under 4x throttling (Playwright with a Chrome trace) and on a phone. Record the numbers in the PR. If it misses AC-L9, change the engine here, before any further work, satisfies **AC-L7**, **AC-L8**, **AC-L9**
3. Production pan and culler engine, kept as a client only module, with the drag threshold and the zero size world container, satisfies **AC-L7**, **AC-L8**, **AC-L12**, **AC-L15**
4. `/discover` route: server fetch of summaries, the bucket proxy route, client bucket fetch and cache, Bangkok's seven slots, placeholders, satisfies **AC-L10**, **AC-L12**, **AC-L14**, **AC-L16**
5. Tile and exit tile rendering through `tourHref` and `exitHref`, keyboard and focus handling, the `canvas_tile_click` and `canvas_bucket_enter` events, satisfies **AC-L11**, **AC-L13**

Slice 2 (all six cities):
6. Enable all six cities, then run the mobile and performance pass as the gate before navigation work begins, satisfies **AC-L9**, **AC-L14**

## Consequences

**Positive**:
- The layout can be tested hard because it is pure, and later reused for share cards.
- The spike makes the biggest risk visible in the first week.

**Negative / tradeoffs**:
- Pinning rank 1 beside the title block (AC-L6) costs fit. Measured at 50 tiles with 50% of them 1:1: 7 of 500 seeds (1.4%) lose one tile, rank 50 six times and rank 49 once, where the same seeds without the pin lose none. The pin is a design requirement, so it stays. `dropped` exists for the case where a bucket reaches 50% 1:1 tiles, which real data does not: the 42 buckets run from 12% to 42%, and all 42 place every tile with at least 6.4 px clearance. Up to 40% 1:1 at 50 tiles there were no drops in 500 seeds per share.
- A hand rolled pan on touch devices has many small edge cases (multi touch, browser back swipe, iOS rubber banding) that a library would have absorbed.
- Fixed caption heights mean a very long title is clamped, never fully shown on the tile.
- Release inertia is in the Slice 1 build. The remaining risk is that the glide feels wrong (too long, too short, or too abrupt), which is tuned on the device.
- Tile images in the production build must be the tier sized variants. With them a pan decodes about 4 MP, against 15 to 26 MP in the spike's `full` mode, which loaded the feed's full size images. The gate passed on a fast phone only, so a check on a lower end phone belongs in the production build's test plan.

**Neutral**:
- Tier photo sizes are held in `@folio/shared` and move when the tile design child changes them.

## Follow-up

- [x] Add rank 1 beside the title to the layout function (the prototype does not have it yet).
- [x] Decide on release inertia after the spike, from how the pan feels on the phone. Decided: release inertia ships in Slice 1, see **AC-L8**.
- [ ] `layoutBucket`'s clearance check still models the whole tile, caption included, as rotated. That is conservative and remains valid for the rendered geometry (photo tilted, caption upright), so nothing is wrong today. The next time the shared function is touched, make it model the rendered geometry instead.
- [ ] If the property test finds a bucket that cannot meet 6 px clearance, change the rule set in `tiers.ts` and the placement scoring, and record the change here.

## Rationale

Fixed caption heights keep the layout a pure function. A measured height would make positions depend on fonts and devices, which breaks shared links and tests. The prototype's estimated heights must not ship. The property test replaces the single 10.61 px sample, which proved one bucket only. The spike comes first because a pan that cannot hold 60 frames would invalidate the whole fixed scale design, and it is cheaper to learn that on synthetic tiles than after the full build.
