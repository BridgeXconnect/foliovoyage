# BRI-245, step 1: canvas removal inventory

Decisions: see the BRI-245 removal PR.

**Linear:** BRI-245 (child of BRI-223; successor epic BRI-244). **Date:** 8 Oct 2026.
**Mode:** read-only. No tracked file changed, no branch, no commit. This file is the only artifact and is left untracked.
**Base:** `origin/master` at `d2e39a7` (#120). All code facts below were read from that tree.

**Headline:** the removal is **not a pure deletion**. Four findings contradict the starting position; see Step 0 and the Questions.

1. `packages/shared/src/canvas/geometry.ts` (not `layout.ts`) holds `MAX_TILES_PER_BUCKET`, the tier definitions, `CANVAS_CITIES`, `CANVAS_CATEGORIES` and `EXCLUDED_CATEGORY_TAG_ID`. The feed, the API specs and the tour page need them, so `geometry.ts` is a **split**, not a delete. `layout.ts` has no outside consumer and deletes cleanly.
2. The surviving **tour page links to `/discover` in three places** (back link, 404 page body, 404 route), and spec 0005 (which stays in force) pins those links in AC-8, AC-13 and AC-17.
3. After the view goes, the **proxy route and `fetchCanvasSummaries` have no in-repo caller**. `bucket-store.ts` is the proxy's only browser consumer and `discover/page.tsx` is the summaries' only caller. They are kept per the starting position, but they are dead until EP-21.
4. `canvas_nav_jump` / `trackCanvasNavJump` has **no caller**: navigation (minimap, search, position URL) was never built, so spec 0004's navigation sub-spec has no code to delete.

---

## Step 0: Findings

**0.1 Up to date.** `master` == `origin/master` == `d2e39a7`, working tree clean. My first fetch saw `bac943b` (#119); PR #120 merged during this session, so I re-fetched and re-validated. `bac943b..d2e39a7` changed 16 files: agent skills, `skills-lock.json`, `AGENTS.md` (+36), `docs/agents/issue-tracker.md`, and the map file. It changed **nothing under `apps/` or `packages/`**, so every code fact below is unaffected by it.

**0.2 Open PRs.** `gh pr list --state open` returns **0 PRs**, so none touches any Step 1 path, `AGENTS.md` or `docs/specs/_root/0004-discovery-canvas/`.

**0.3 BRI-243.** **Merged**: PR #120, `d2e39a7`, 2026-10-08T15:12Z. No rebase-after-it constraint. Cut the removal branch from `d2e39a7` or later. The map file on master is now the restructured map (EP-20 shelved, EP-21).

**0.4 Other branches.** ~14 local/remote branches show diffs against `canvas-surface` paths (for example `feat/canvas-discover-bangkok`, `feat/canvas-tile-opens-tour-page`). I spot-checked two (#111) and they are squash-merged leftovers; the repo squash-merges, so three-dot diffs against `master` are noise. None is an open PR. No action needed.

**0.5 Toolchain.** `git grep` (word-boundary, per export name) over `apps/` and `packages/`, plus a small Node script that parses every `import { … } from "@folio/shared"` outside the three canvas-owned folders (the script is how I traced re-exports: `packages/shared/src/index.ts` is a barrel with `export *` from `./api`, `./canvas/geometry`, `./canvas/layout`, so every consumer imports by name from `@folio/shared`). No deep `@folio/shared/canvas/*` import exists anywhere. **I did not run `tsc`'s reference tooling, tests or builds**; no baseline was run. There is no `apps/web/src/data/types.ts`-style canvas re-export file.

**0.6 Starting position, verified.**

| Claim | Result |
|---|---|
| Keep the feed (`apps/api/src/canvas/*`, shared schemas, `canvas-api.ts`, proxy route) | **Confirmed**, with the caveat that the web side of the feed has no caller after removal (Finding 3). |
| `experiences.service.ts` imports `pickLargestImage` from `../canvas/canvas-image` | **Confirmed** (`experiences.service.ts:4`, used at `:93`). It is the only outside consumer. |
| Delete `apps/web/src/canvas/**` | **Wrong for 4 files.** `format.ts` (+spec) is imported by the tour page; `links.ts` (+spec) holds `tourHref`, the writer of the `?from=` contract. See Step 3. |
| Delete `packages/shared/src/canvas/{layout,geometry}.ts` | **`layout.ts`: confirmed. `geometry.ts`: wrong, it splits** (Finding 1). |
| Delete `fixtures/real-buckets.json` | **Confirmed.** Only `layout.spec.ts:389` and `clearance.spec.ts:116` read it. |
| `MAX_TILES` and tier definitions might sit in `layout.ts` | **No. They are in `geometry.ts`** (`MAX_TILES_PER_BUCKET` :43, `TIER_LAST_RANK` :48, `tierForRank` :51). |

---

## Step 1: The canvas surface

### 1.1 Files in the named folders (28 + 1 + 1 + 9 + 5 + 3)

**`apps/web/src/canvas/`** (28 files, 3,090 lines)

| File | Lines | File | Lines |
|---|---:|---|---:|
| `CanvasItem.tsx` | 153 | `engine/sections.ts` | 89 |
| `DiscoverCanvas.tsx` | 224 | `engine/view.ts` | 60 |
| `bucket-store.ts` | 83 | `format.ts` | 40 |
| `bucket-store.spec.ts` | 95 | `format.spec.ts` | 42 |
| `clearance.spec.ts` | 147 | `links.ts` | 32 |
| `route-guards.spec.ts` | 83 | `links.spec.ts` | 43 |
| `scene.ts` | 197 | `perf/PerfOverlay.tsx` | 161 |
| `scene.spec.ts` | 132 | `perf/auto-pan.ts` / `.spec.ts` | 21 / 28 |
| `engine/index.ts` | 11 | `perf/params.ts` / `.spec.ts` | 44 / 26 |
| `engine/input.ts` | 79 | `perf/stats.ts` / `.spec.ts` | 199 / 77 |
| `engine/motion.ts` / `.spec.ts` | 131 / 157 | `engine/engine.spec.ts` | 163 |
| `engine/pan-controller.ts` / `.spec.ts` | 331 / 242 | | |

**`apps/web/src/app/discover/`**: `page.tsx` 39.
**`apps/web/src/app/api/canvas/`**: `buckets/[city]/[cat]/route.ts` 13.
**`apps/web/src/lib/`**: `canvas-api.ts` 72, `canvas-api.spec.ts` 82.

**`apps/api/src/canvas/`** (9 files, 1,208 lines): `canvas-categories.ts` 36, `canvas-categories.spec.ts` 50, `canvas-image.ts` 104, `canvas-image.spec.ts` 114, `canvas.controller.ts` 39, `canvas.controller.spec.ts` 38, `canvas.module.ts` 14, `canvas.service.ts` 287, `canvas.integration.spec.ts` 526.

**`packages/shared/src/canvas/`**: `geometry.ts` 202, `geometry.spec.ts` 171, `layout.ts` 395, `layout.spec.ts` 406, `fixtures/real-buckets.json` 2,122.
**`packages/shared/src/`**: `canvas-api.spec.ts` 59.

### 1.2 Canvas pieces outside those folders

**Exported names** (all re-exported by `@folio/shared`'s barrel):

| File | Names |
|---|---|
| `shared/canvas/geometry.ts` | World: `SLOT_WIDTH`, `SLOT_HEIGHT`, `CITY_REGION_SLOT_COLUMNS/ROWS`, `CITY_REGION_WIDTH/HEIGHT`, `WORLD_CITY_COLUMNS/ROWS`, `WORLD_WIDTH/HEIGHT`, `SECTION_SIZE`, `SECTION_OVERSCAN`. Feed shape: `MAX_TILES_PER_BUCKET`, `TileTier`, `TIER_LAST_RANK`, `tierForRank`. Layout: `TIER_PHOTO_WIDTH`, `TIER_CAPTION_HEIGHT`, `TIER_CAPTION_GAP`, `GRID_SIZE`, `GUTTER`, `MARGIN`, `CLEARANCE`, `JITTER`, `TILT_DEGREES`, `SCORE_X_WEIGHT`, `SQUARE_SHAPE_PERCENT`, `PERCENT_BASE`, `LANDSCAPE_RATIO`, `TILT_STEPS_PER_DEGREE`, `DEGREES_PER_HALF_TURN`, `RANK_ONE_OFFSET`, `TITLE_BLOCK`, `EXIT_TILE_WIDTH/HEIGHT/CORNER`. Lists: `CanvasCity`, `CANVAS_CITIES`, `CanvasCategory`, `CANVAS_CATEGORIES`, `EXCLUDED_CATEGORY_TAG_ID`, `CanvasCitySlug`, `CanvasCategorySlug`. Slots: `Point`, `slotOriginByIndex`, `slotOrigin`, `slotCentre`. |
| `shared/canvas/layout.ts` | `Rect`, `TileShape`, `Placement`, `LayoutInput`, `LayoutResult`, `fnv1a`, `mulberry32`, `layoutBucket` |
| `shared/api.ts` (lines ~95-158) | `canvasImageSchema`/`CanvasImage`, `canvasBucketSummarySchema`/`CanvasBucketSummary`, `canvasBucketsResponseSchema`/`CanvasBucketsResponse`, `canvasTileSchema`/`CanvasTile`, `canvasBucketResponseSchema`/`CanvasBucketResponse` |
| `api/canvas/canvas-image.ts` | `SM_FIRST_RANK`, `MIN_WIDTH_SM`, `MIN_WIDTH_MD_LG`, `minWidthForRank`, `pickImage`, `pickLargestImage` |
| `api/canvas/canvas-categories.ts` | `CanvasCategoryCopy`, `CANVAS_CATEGORY_COPY`, `SHOWN_CATEGORY_TAG_IDS`, `categoryBySlug` |
| `api/canvas/canvas.service.ts` | `MAX_TILES`, `BAYESIAN_M`, `CACHE_TTL_MS`, `CanvasService`, `CANVAS_FEED_CITIES` |
| `web/lib/canvas-api.ts` | `fetchCanvasSummaries`, `proxyCanvasBucket` |
| `web/canvas/format.ts` | `formatDuration`, `formatPrice`, `formatRating` |
| `web/canvas/links.ts` | `TileRef`, `tourHref`, `exitHref`, `exitTileCopy` |

**CSS and theme** (`apps/web/src/app/globals.css`): lines 34-46 (the `Discovery canvas` comment and `--container-tile-lg/md/sm`, `--container-caption-sm/md/lg`, `--container-panel`, `--leading-xs`, `--leading-sm`); lines 49-55 (`.canvas-root`: `--leading-tight`, `--text-lg`, `--text-base`). **Canvas-only**: no `leading-xs/sm`, `*-panel`, `container-tile/caption` utility is used outside `canvas/` and `discover/`, and `.canvas-root` is used only by `discover/page.tsx:34`.

**Analytics** (`apps/web/src/lib/analytics.ts` lines 110-167): `CanvasBucketEnterSource`, `trackCanvasBucketEnter` (`canvas_bucket_enter`), `trackCanvasTileClick` (`canvas_tile_click`), `trackCanvasNavJump` (`canvas_nav_jump`). Only `DiscoverCanvas.tsx` calls the first two (`:129`, `:160`); **the third has no caller**. `analytics.spec.ts` (46 lines) tests only `trackCanvasTileClick`.

**Config.** `robots.ts:24-26` disallows `/api/canvas/` (the feed proxy carries ratings); `robots.spec.ts:16,23` pin it. `sitemap.spec.ts:36-41` asserts no `/discover` URL. `middleware.ts` has a generic matcher and no canvas mention. `next.config.ts` has only the `/protected/tour-rating.js` header. No redirects or headers mention `/discover`. There is **no `vercel.json`** in the repo.

**Tests / perf.** No Playwright or e2e files. No perf script outside `apps/web/src/canvas/perf/`. All tests are jest.

**Dependencies.** The canvas folders import only `react`, `next`, `next/dynamic`, `@folio/shared`, `@/…`, `node:fs/path` and `@jest/globals`. **No npm dependency is canvas-only**; `three` and `maplibre-gl` belong to `components/map/`. `zod` in `@folio/shared` is used by `api.ts`. `package.json` and `pnpm-lock.yaml` need no change.

**Fixtures.** `real-buckets.json` is used only by `layout.spec.ts:389` and `clearance.spec.ts:116`, both slated for deletion.

**Other mentions** (no change needed unless noted): `apps/api/prisma/schema.prisma:280` (comment on the indexed category column; feed stays), `app.module.ts:5,29` (`CanvasModule`; feed stays), `tour-go.ts:14` and `viator-url.spec.ts` (`campaign=canvas-tour`, an affiliate attribution string; see Q9).

---

## Step 2: Consumers

"✗" marks a consumer slated for deletion. Only surviving consumers matter.

### 2.1 Shared exports

| Export(s) | Outside-folder importers (path:line) | Survives? |
|---|---|---|
| `CANVAS_CITIES` | `app/discover/page.tsx:2,21` ✗; `components/tour/TourNotFoundBody.tsx:5,20`; `lib/tour-from.ts:10,26`; `lib/canvas-api.ts` (imports, `:8`) | **Yes** |
| `CANVAS_CATEGORIES` | `lib/tour-from.ts:10,27`; `lib/canvas-api.ts`; `api/canvas/canvas-categories.spec.ts`, `canvas.integration.spec.ts` (parity pins) | **Yes** |
| `MAX_TILES_PER_BUCKET` | `shared/api.ts:3,156` (`canvasBucketResponseSchema`); `shared/canvas-api.spec.ts:9`; `api/canvas/canvas-categories.spec.ts` (pins `MAX_TILES`) | **Yes** |
| `TIER_LAST_RANK` | `api/canvas/canvas-categories.spec.ts` (pins `SM_FIRST_RANK`), `canvas-image.spec.ts:2` | **Yes** |
| `EXCLUDED_CATEGORY_TAG_ID` | `api/canvas/canvas-categories.spec.ts` | **Yes** |
| `TileTier`, `tierForRank` | no importer outside `geometry.ts` itself and its spec | Keep with the tier definition (Q4) |
| `CanvasCity`, `CanvasCategory`, `CanvasCitySlug`, `CanvasCategorySlug` | only as the type behind the keepers above (`links.ts` imports `CanvasCity`, `CanvasTile`) | Keep (types of surviving lists) |
| `canvasImageSchema` / `CanvasImage` | **`shared/api.ts:177` (`experiencePageSchema.image`, the tour page contract)**; `api/canvas/canvas-image.ts:1`; `web/canvas/scene.ts:34` ✗ | **Yes** |
| `canvasBucketSummarySchema` / `CanvasBucketSummary` | `app/discover/page.tsx:2,24` ✗; `lib/canvas-api.ts`; `api/canvas/canvas.service.ts` | **Yes** (feed) |
| `canvasBucketsResponseSchema` | `lib/canvas-api.ts`; `api/canvas/canvas.integration.spec.ts` | **Yes** (feed) |
| `canvasTileSchema`, `canvasBucketResponseSchema` and their types | `web/canvas/bucket-store.ts:` ✗ (browser parse), `api/canvas/canvas.service.ts`, `canvas.controller.ts`, `canvas.integration.spec.ts` | **Yes** (feed) |
| `TIER_PHOTO_WIDTH`, `TIER_CAPTION_HEIGHT`, `TIER_CAPTION_GAP`, `LANDSCAPE_RATIO`, `EXIT_TILE_*`, `GRID_SIZE` … `RANK_ONE_OFFSET`, `TITLE_BLOCK`, `SLOT_*`, `CITY_REGION_*`, `WORLD_*`, `SECTION_*`, `Point`, `slotOrigin*`, `slotCentre` | only `web/canvas/*` (`CanvasItem`, `DiscoverCanvas`, `scene`, `PerfOverlay`, `route-guards.spec`, `clearance.spec`, `engine.spec`) ✗, `layout.ts` ✗, `geometry.spec.ts` | **None survive** (but see Q4 on the decided tokens) |
| `Rect`, `TileShape`, `Placement`, `LayoutInput`, `LayoutResult`, `fnv1a`, `layoutBucket` | only `web/canvas/scene.ts` ✗, `clearance.spec.ts` ✗, `layout.spec.ts` ✗ | **None survive** |
| `mulberry32` | none. `api/modules/content/tour-copy-eval-sample.ts:56` defines its own `seededRandom` (the text hit is a doc comment) | None |

### 2.2 `pickLargestImage`, `pickImage`, `CanvasImage`

| Name | Consumers |
|---|---|
| `pickLargestImage` | **`apps/api/src/experiences/experiences.service.ts:4,93`** (tour page, spec 0005). Spec: `canvas-image.spec.ts:4,84-112`. **No other.** |
| `pickImage` | `apps/api/src/canvas/canvas.service.ts:13,225,258` (feed). Spec: `canvas-image.spec.ts`. |
| `CanvasImage` (type) | `canvas-image.ts:1,43,56,88`; `web/canvas/scene.ts:34,60` ✗; defined at `shared/api.ts:106` |
| `SM_FIRST_RANK` | `canvas-image.ts:16,48`; pinned by `canvas-categories.spec.ts:13,48` (`SM_FIRST_RANK === TIER_LAST_RANK.md + 1`) |

### 2.3 Constants pinned across packages

- **`CANVAS_CATEGORY_COPY` (api) ↔ `CANVAS_CATEGORIES`**: `canvas-categories.spec.ts` pins slug, label and tag id. The shared constant is `CANVAS_CATEGORIES` in **`packages/shared/src/canvas/geometry.ts:154`**.
- **`MAX_TILES` (`canvas.service.ts:30`) ↔ `MAX_TILES_PER_BUCKET`** in **`geometry.ts:43`**.
- **`SM_FIRST_RANK` (`canvas-image.ts:16`) ↔ the tier boundary `TIER_LAST_RANK.md`** in **`geometry.ts:48`** (`{ lg: 4, md: 20, sm: MAX_TILES_PER_BUCKET }`). The shared constant is `TIER_LAST_RANK`, **not** in `layout.ts`.
- **`CANVAS_CITIES`** (`geometry.ts:133`) is pinned to `curated-cities.ts` by a parity test in `canvas-categories.spec.ts`.
- **`EXCLUDED_CATEGORY_TAG_ID`** (`geometry.ts:165`) is pinned to `category-rule.ts`.

**Answer to "do `MAX_TILES` and the tier definitions live in `layout.ts`?"** No. All of them live in `geometry.ts`. `layout.ts` only *consumes* them. So these constants do **not** have to move: keep `geometry.ts` in place and trim it (Step 3). No pinned constant is homeless. If `geometry.ts` were deleted outright, the destination would have to be a new file in `packages/shared/src/canvas/` (kept filename recommended instead, Q4/Q8).

### 2.4 `apps/api` imports from `@folio/shared/canvas/*`

**None.** `apps/api` imports only the barrel `@folio/shared`, and only inside `apps/api/src/canvas/` plus the destinations and experiences modules (which use non-canvas schemas). In `apps/api` **source** all canvas imports are `import type` (the CommonJS limit noted in `canvas-categories.ts:5`); the **specs** import values (`CANVAS_CATEGORIES`, `CANVAS_CITIES`, `EXCLUDED_CATEGORY_TAG_ID`, `MAX_TILES_PER_BUCKET`, `TIER_LAST_RANK`, `canvasBucket*Schema`) from the barrel, which is why those exports must stay.

### 2.5 Web modules

| Module | Outside-folder importers | Survives? |
|---|---|---|
| `canvas/format.ts` | **`components/tour/TourPageView.tsx:4`** (`formatDuration`, `formatPrice`, used `:22`, `:36`). Spec 0005 names this exact path (lines 93, 94). `formatRating`: only `CanvasItem.tsx` ✗. | **Yes** |
| `canvas/links.ts` | none outside the folder. `CanvasItem.tsx` ✗ calls it. The reader of its `?from=` output is `lib/tour-from.ts`; `links.spec.ts:` imports `parseFrom` for the round trip. | `tourHref`: **needed by any bucket view** (spec 0004 AC-6). `exitHref`/`exitTileCopy`: Q3. |
| `canvas/bucket-store.ts` | `DiscoverCanvas.tsx:20` ✗, `scene.ts:40` ✗. It is the **only** caller of `/api/canvas/buckets/…`. | No |
| `canvas/DiscoverCanvas.tsx` | `app/discover/page.tsx:3` ✗ | No |
| `canvas/{engine,perf,scene,CanvasItem}` | only each other ✗ | No |
| `lib/canvas-api.ts` | `fetchCanvasSummaries`: `discover/page.tsx:4,26` ✗. `proxyCanvasBucket`: the proxy `route.ts:1,12`. | File survives; **`fetchCanvasSummaries` has no surviving caller**; the route has no in-repo caller (Q5). |
| `app/api/canvas/…/route.ts` | no importer; reachable by URL only | Keep (Q5) |
| Tour page and `/discover` links | `components/tour/TourBackLink.tsx:32` (`href="/discover?at=…"`), `components/tour/TourNotFoundBody.tsx:36` (`href="/discover"`), `app/tours/[experienceId]/not-found.tsx:28` (`href="/discover"`), and their specs (`TourBackLink.spec.tsx:20,36`, `TourNotFoundBody.spec.tsx:42-57`, `not-found.spec.tsx:16-19`; `page.spec.tsx:233` is a negative assertion, fine) | **All survive and break.** Q1. |

---

## Step 3: Proposed fate

Line counts are from `origin/master`. "≈" marks a split where I estimated the retained lines.

| Path / export | Lines | Consumers that survive | Fate | Reason | Tests that go with it |
|---|---:|---|---|---|---|
| `apps/web/src/canvas/CanvasItem.tsx` | 153 | none | **delete** | View only. Caption styling is tied to the tier/fixed-caption system and the masonry tile design is still open (map O2, O14); extracting now is guessing (Q10). | none of its own |
| `…/DiscoverCanvas.tsx` | 224 | none | **delete** | View | none |
| `…/bucket-store.ts` | 83 | none | **delete** | Only browser consumer of the proxy | `bucket-store.spec.ts` (95) |
| `…/scene.ts` | 197 | none | **delete** | Layout-to-DOM glue | `scene.spec.ts` (132) |
| `…/engine/*` (7 files) | 902 | none | **delete** | Pan, culler, motion | `engine.spec.ts` 163, `motion.spec.ts` 157, `pan-controller.spec.ts` 242 (included above) |
| `…/perf/*` (4 files + 3 specs) | 556 | none | **delete** | Perf harness for the canvas only | `auto-pan.spec`, `params.spec`, `stats.spec` |
| `…/clearance.spec.ts` | 147 | none | **delete** | Tests the layout clearance on the fixture | n/a |
| `…/route-guards.spec.ts` | 83 | none | **delete** | Guards `/discover`. Its sitemap check is already in `sitemap.spec.ts:38`; noindex/robots/token/"no other route imports canvas" checks go with the page and tokens. | n/a |
| `…/format.ts`: `formatDuration`, `formatPrice` | ≈ 29 | **`TourPageView.tsx:4`** | **move → `apps/web/src/lib/format.ts`** | Pure, no canvas dependency, used by the tour page. `lib/` is a flat folder of `<name>.ts` + `<name>.spec.ts` (the only other formatter, `formatFromPrice`, is in `lib/experience-detail.ts`). Update the import (`TourPageView.tsx:4`) and spec 0005 lines 93-94. | `format.spec.ts` (42) → `lib/format.spec.ts` |
| `…/format.ts`: `formatRating` | ≈ 5 | none (`CanvasItem` only) | **Q2** (default: move with the file) | Pure, but ratings are Viator protected content (docs/06 line 67) | in `format.spec.ts` |
| `…/links.ts`: `tourHref`, `TileRef` | ≈ 14 | none today; every bucket view needs it (0004 AC-6, 0005 AC-16) | **move → `apps/web/src/lib/tour-from.ts`** | `tour-from.ts` is the parser of the `?from=` value `tourHref` writes; its header already documents the contract. Writer and reader in one file. | `links.spec.ts` (43) → `tour-from.spec.ts` (it already round-trips with `parseFrom`) |
| `…/links.ts`: `exitHref`, `exitTileCopy` | ≈ 8 | none | **Q3** (default: delete) | Exit tile (AC-T6) is "carried" by the map but no surviving code uses it | in `links.spec.ts` |
| `apps/web/src/app/discover/page.tsx` | 39 | none | **delete** | The route | `route-guards.spec.ts` (above) |
| `apps/web/src/app/api/canvas/buckets/[city]/[cat]/route.ts` | 13 | none in-repo (Q5) | **keep** | Feed proxy (starting position) | `canvas-api.spec.ts` |
| `apps/web/src/lib/canvas-api.ts` | 72 | proxy route | **keep** (Q5: `fetchCanvasSummaries` dead) | Feed access | `canvas-api.spec.ts` (82), keep |
| `apps/web/src/app/globals.css` lines 34-46 and 48-55 | ≈ 21 | none | **delete** | Canvas-only tokens and `.canvas-root` (verified, 1.2). Keep `}` at line 47. | token tests in `route-guards.spec.ts` (deleted) |
| `apps/web/src/lib/analytics.ts` lines 110-167 | ≈ 58 | none | **delete** | `trackCanvasBucketEnter`, `trackCanvasTileClick`, `trackCanvasNavJump`, `CanvasBucketEnterSource` | `analytics.spec.ts` (46, whole file) **delete** |
| `components/tour/TourBackLink.tsx:32`, `TourNotFoundBody.tsx:36`, `tours/[experienceId]/not-found.tsx:28` | 3 lines | **they are the survivors** | **edit** (Q1) | They link to a removed route | `TourBackLink.spec.tsx:20`, `TourNotFoundBody.spec.tsx:42-57`, `not-found.spec.tsx:16-19`: update |
| `apps/web/src/app/sitemap.spec.ts:36-41` | 6 | n/a | **edit** (optional) | Comment says "the canvas are noindex"; reword; the `/discover` assertion can stay | n/a |
| `apps/web/src/app/robots.ts:24-26`, `robots.spec.ts` | n/a | feed proxy | **keep** | `/api/canvas/` stays disallowed | `robots.spec.ts` |
| `packages/shared/src/canvas/layout.ts` | 395 | none | **delete** | Layout function; no outside consumer | `layout.spec.ts` (406) |
| `packages/shared/src/canvas/fixtures/real-buckets.json` | 2,122 | none | **delete** | Only the two deleted specs read it | n/a |
| `packages/shared/src/canvas/geometry.ts` | 202 | `api.ts:3,156`; `tour-from.ts`; `TourNotFoundBody.tsx`; `canvas-api.ts`; API specs | **split** (in place, filename kept; Q8) | **Keep (≈ 71 lines):** `MAX_TILES_PER_BUCKET`, `TileTier`, `TIER_LAST_RANK`, `tierForRank`, `CanvasCity`, `CANVAS_CITIES`, `CanvasCategory`, `CANVAS_CATEGORIES`, `EXCLUDED_CATEGORY_TAG_ID`, `CanvasCitySlug`, `CanvasCategorySlug`, trimmed header (drop the "purity rule" and slot text). **Delete (≈ 131 lines):** every `SLOT_*`, `CITY_REGION_*`, `WORLD_*`, `SECTION_*`, layout constants (`GRID_SIZE` … `RANK_ONE_OFFSET`, `TITLE_BLOCK`), `TIER_PHOTO_WIDTH`, `TIER_CAPTION_HEIGHT`, `TIER_CAPTION_GAP`, `EXIT_TILE_*`, `Point`, `slotOriginByIndex`, `slotOrigin`, `slotCentre`. Decided tokens (68/57/14, 240×160): Q4. | `geometry.spec.ts` |
| `packages/shared/src/canvas/geometry.spec.ts` | 171 | n/a | **split** | **Keep (≈ 66 lines):** the city/category order test (`:30`), "never lists the excluded category" (`:53`), "maps rank to tier" (`:106`). **Delete (≈ 105):** derived sizes (`:24`), slot centre/unknown slug/42-slots/exit-tile tests (`:74-102`), and the whole "canvas folder purity" describe (`:116-171`). | itself |
| `packages/shared/src/index.ts:101` | 1 | n/a | **edit** | Remove `export * from "./canvas/layout"`; keep `:100` (`geometry`) | n/a |
| `packages/shared/src/api.ts` (lines ~95-158) | ≈ 64 | feed, tour page (`:177`) | **keep** | Feed wire schemas; `canvasImageSchema` is reused by the tour page | `canvas-api.spec.ts` (59) keep |
| `apps/api/src/canvas/*` (9 files) | 1,208 | feed; `experiences.service.ts` | **keep** | The feed | all 4 api specs + integration spec keep |
| `apps/api/src/canvas/canvas-image.ts`: `pickLargestImage` | ≈ 20 | `experiences.service.ts:4,93` | **keep** (in place; Q7) | Tour page depends on it | `canvas-image.spec.ts:84-112` |

**Totals (approximate).**

| Fate | Files | Lines |
|---|---:|---:|
| **Delete whole files** | 29 (24 in `web/src/canvas`, `discover/page.tsx`, `layout.ts`, `layout.spec.ts`, `real-buckets.json`, `analytics.spec.ts`) | **≈ 6,100** (of which `real-buckets.json` 2,122; ≈ 3,980 without it) |
| **Delete inside split files** | 4 (`geometry.ts`, `geometry.spec.ts`, `analytics.ts`, `globals.css`) | **≈ 315** (131 + 105 + 58 + 21) |
| **Move** | 4 (`format.ts` + spec, `links.ts` + spec) | **157** (82 + 75; net 0 lines, minus whatever Q2/Q3 drop) |
| **Keep unchanged** | 17 (9 api canvas, `canvas-api.ts` + spec, route, `canvas-api.spec.ts`, plus `api.ts` block) | **≈ 1,430** + `api.ts` block ≈ 64 |
| **Keep after trimming** | `geometry.ts`, `geometry.spec.ts` | ≈ 137 |

---

## Step 4: Docs that describe the canvas as live

**No `AGENTS.md` describes the canvas as live.** Root `AGENTS.md` mentions it only at lines 201, 203, 215, all added by #120 and already shelf-aware (`~/dev/canvas-Gallery`; "EP-21 … inherits shelved EP-20's map"). `apps/web`, `apps/api`, `packages/shared` AGENTS.md: **0 mentions**. No change proposed. (Optional: after the removal, `apps/web/AGENTS.md` and `apps/api/AGENTS.md` have no canvas section and the API's `canvas/` module is undocumented there; a one-line pointer to spec 0004's feed sub-spec could be added by `/sync`, not required.)

**`docs/02`, `docs/03`:** **no canvas FR/story IDs and no EP-20.** EP-20 is **not mirrored in docs/03**, so EP-21 does **not** need an entry there under the docs-hierarchy rule. The epic is tracked in `docs/scope/` and in Linear only. (docs/01, docs/11, docs/04, docs/06, docs/08, docs/13 only match generic words; docs/06:67 is the Viator protected-ratings rule, relevant to Q2.)

**`docs/scope/_root/discovery-canvas.md`** (79 lines) and **`docs/scope/_root/index.md`**:

| Where | Change (one line) |
|---|---|
| `discovery-canvas.md:1-3` | Mark EP-20 shelved 8 Oct; point to the EP-21 map. |
| `:19` (row 13, layout and rendering), `:34` (row 14, navigation), `:48` (row 15, tile design) | Status `in-progress` → `shelved` (view removed under BRI-245). |
| `:7` (row 12, feed) | Stays `in-progress`/in force; note it feeds EP-21. |
| `:62` (row 16, tour page) | Keep; adjust "Done when: a canvas tile… opens a page" to "a bucket tile". |
| `:76` (row 17, rating path) | **Stale already**: `Disallow: /api/canvas/` shipped in #116 (`robots.ts:26`) but the row says `planned` (Q11). |
| `docs/scope/_root/index.md:29-32` (rows 13-15), `:41` (epic rollup), `docs/scope/index.md:7` | Mirror the status change and the rollup counts. |

**Spec 0004** (`docs/specs/_root/0004-discovery-canvas/`):

| Where | Change (one line) |
|---|---|
| `index.md:4` | `Status: In Progress` → `Partly superseded (view shelved 8 Oct, BRI-245); feed in force`. |
| `index.md:15-17` | Mark the layout, tile-design and navigation bullets **superseded**. |
| `index.md:28-29, 31-34` (AC-1, AC-2, AC-4, AC-5 nav part, AC-6, AC-7) | Mark **superseded** (they govern the view). **AC-3 stays** (feed rule). |
| `index.md:60-90` | "World geometry": keep the **city and category order, slugs and labels** (the feed cites them, see below); mark slot/region/world/section sizes superseded. "Layout constants": superseded (decided tokens move to the EP-21 spec, Q4). |
| `index.md:91-107` | "Client fetch path" (the proxy route) stays; "Analytics events" (`canvas_*`) superseded. |
| `index.md:113-126` | Build plan steps 3-9 superseded. |
| Sub-specs: layout (`0004-canvas-layout-rendering.md`), tile-design (`…tile-design.md`), navigation (`…navigation.md`) | Add a "Superseded 8 Oct (BRI-245)" banner line. Feed spec (`…feed-endpoint.md`): add "In force; feeds EP-21". |

**Cross-references between the four sub-specs.**
- `0004-canvas-layout-rendering.md:66` links to the **feed** spec ("the page calls the feed endpoints").
- `0004-canvas-tile-design.md:38` cites **AC-L9** (layout spec's performance gate).
- The **feed spec** cites **no** other sub-spec and no `AC-L`/`AC-T`/`AC-N`. It leans only on `index.md`: `:3` (world geometry, shared types, cross-child contract), AC-F1 (`:17`, "fixed world order from index.md"), AC-F3 (`:19`, "city in the shared geometry list … see index.md"), and Follow-up `:110`.
- The **tier and cap definitions** the feed uses are restated inside the feed spec itself: AC-F2 (cap 50, `:18`), AC-F7 (`sm` rank 21-50, `:19`), `:36` (hard cap 50), `:73` (`m` = 10 and the 50 cap). Only the **city/category order** is by reference to `index.md`. So when superseding the view parts of `index.md`, keep the order, slugs and labels in force or inline them into the feed spec.
- `index.md` umbrella ACs: AC-1/2/4/5/6/7 reference the layout/navigation/tile children; AC-3 references the feed; the shared AC IDs are only the umbrella ones.

**Spec 0005 (tour page, stays in force) lines that name the removed route or moved files:** `:26` (AC-8, 404 links to `/discover`), `:31` (AC-13, back link to `/discover?at=…`), `:34` (AC-16, `tourHref`), `:35` (AC-17, "back link returns to the canvas"), `:58`, `:93-94` (`apps/web/src/canvas/format.ts`), `:89` (`canvas-image.ts`, unchanged), `:147`, `:160`, `:188`. These need an edit through `/architect` as part of Q1.

**`docs/design/open-items-for-designer.md`:** `:3` ("The discovery canvas (`/discover`) is built… works"), items 1-3, 9, 10 (layout, tilt, rounded corners, clearance), `:78-79` (back link, 404 link). Proposed: add a one-line banner "Canvas shelved 8 Oct; items 1-3, 9, 10 are moot; 6 (exit tile) and 7 (city/category order) carry to EP-21"; update `:78-79` per Q1.

**Plans folder:** `2026-09-25`, `-27`, `2026-10-01`, `-03` are canvas-era history; no change. The 5 Oct file is the map (edited only by the planning chat).

---

## Step 5: Runtime and config

| Claim | Verdict |
|---|---|
| No Railway / `.railway/railway.ts` change needed | **Confirmed.** No `canvas` in `.railway/railway.ts`; the feed stays in `@folio/api`; no service, cron or variable is canvas-specific. |
| No env var exists only for the canvas | **Confirmed.** `canvas|Canvas|CANVAS` has zero hits in `apps/api/.env.example`, `apps/web/.env.example`, `env.validation.ts`, `turbo.json` env, or `.railway/railway.ts` (the "bucket" hits are R2 storage). The feed uses `API_BASE_URL`, shared with the rest of the web app. |
| No Vercel config references `/discover` | **Confirmed in the repo only.** There is no `vercel.json`; `next.config.ts` and `middleware.ts` have no `/discover` reference. **Not checked:** redirects/rules set in the Vercel dashboard or via the MCP. The planning chat should check those. |
| No migration needed | **Confirmed.** Only `schema.prisma:280` mentions the canvas, in a comment on `primaryCategoryTagId`; the feed stays and no model, column or index changes. CI's `migrate` job is unaffected. |

**PostHog (inferred from event names; planning chat to check dashboards):**
- `canvas_bucket_enter` (`city`, `category`, `source`): fired only by `DiscoverCanvas.tsx:129` with `source: "pan"`. The other sources (`minimap`, `search`, `link`) were never wired.
- `canvas_tile_click` (`city`, `category`, `rank`, `tier`, `tile_kind`, `experience_id`, `tour_id`): the upstream half of the **canvas to tour-page funnel**. `tour_page_viewed` and `tour_page_not_found` carry `from` (`city.category`, validated) and `category`, so any funnel or insight joining click to page view stops receiving clicks after removal. The `from` / `category` properties on the tour events keep working.
- `canvas_nav_jump`: **never fired.**
- Historic events stay in PostHog; nothing to delete there.

---

## Step 6: Verification plan for the removal PR

From `package.json`, `turbo.json` and `.github/workflows/ci.yml` (CI = `pnpm turbo run lint typecheck test --affected` on a PR; **CI has no build and no integration step**):

```bash
pnpm install --frozen-lockfile          # must succeed; pnpm-lock.yaml and package.json files must be unchanged (git diff --stat)
pnpm lint                               # turbo: @folio/web, @folio/api (eslint src), @folio/shared
pnpm typecheck                          # turbo: tsc --noEmit in all three
pnpm turbo run test                     # jest in all three (what CI runs; api excludes *.integration.spec.ts)
doppler run -- pnpm --filter @folio/web build   # next build; turbo env: API_BASE_URL, SITE_GATE_PASSWORD, INTERNAL_CLICK_SECRET
pnpm --filter @folio/api build          # nest build; shared types changed
pnpm --filter @folio/api test:integration       # canvas.integration.spec.ts imports the trimmed shared exports
```

Notes: the web build and the integration spec are **not in CI**, so they are manual gates for this PR. `test:integration` needs a live Postgres; the local docker `folio-postgres` is on 5433 while `apps/api/.env` may still say 5432 (see the `postgres-port-mismatch` memory), so confirm `DATABASE_URL` before running and run it against the local container only.

Post-change guards (all should return **no** hits): `git grep -nE "@/canvas|canvas/layout|/discover|trackCanvas|canvas-root" -- apps packages`, except the new `@/lib/format` imports; and `git grep -n "canvas/layout" packages`.

**Expected net line change:** ≈ **−6,400 total**, about **−4,300 excluding `real-buckets.json`**. Derivation: delete ≈ 6,100 (whole files) + ≈ 315 (inside split files) = ≈ 6,415; add ≈ 14 (`tourHref` landing in `tour-from.ts` is a move, net 0) + ≈ 10-20 (tour page link edits and spec updates) + ≈ 30-40 doc lines. Moves are net 0.

---

## Questions

1. **Where do the tour page's links to `/discover` go?** `TourBackLink.tsx:32`, `TourNotFoundBody.tsx:36`, `not-found.tsx:28`, their specs, and spec 0005 AC-8/13/16/17 all assume `/discover`. *Recommendation:* back link falls back to the existing `CityBackLink` (`/destinations/:city`); the 404 links to `/destinations`; no redirect for `/discover` (route is `noindex`, site-gated, pre-launch). Keep `parseFrom` and the `from` / `category` analytics properties (EP-21 will need a "from bucket" concept). This needs an `/architect` edit to spec 0005. Is a redirect wanted anyway?
2. **`formatRating`:** move to `lib/format.ts` with the other two (pure, tested) or delete? Ratings are Viator protected content (docs/06:67): a future server-rendered masonry caption must not call it in HTML. *Recommendation:* move, with a one-line "never server-render" comment; or delete and let EP-21 reintroduce it.
3. **`exitHref` / `exitTileCopy`:** the map says the exit tile is carried (AC-T6), but no surviving code uses it. *Recommendation:* delete; the values live in spec 0004.
4. **The decided-but-unused tokens** (`TIER_PHOTO_WIDTH` 360/240/168, `TIER_CAPTION_HEIGHT` 68/57/14, `TIER_CAPTION_GAP`, `EXIT_TILE_*` 240×160, `GRID_SIZE` 8): no surviving consumer. *Recommendation:* delete from code; they remain in spec 0004's `index.md` "Layout constants" table (carry the values into the EP-21 spec). Alternative: keep `TIER_CAPTION_HEIGHT`/`TIER_PHOTO_WIDTH`/`TIER_CAPTION_GAP` in `geometry.ts` so the next view cannot drift from the map's "never measured" rule.
5. **Dead-until-EP-21 feed pieces:** `fetchCanvasSummaries` (zero callers), the proxy route and `proxyCanvasBucket` (zero in-repo callers; reachable by URL only), and the summaries endpoint's schemas. *Recommendation:* keep all, as planned, and note them in the removal PR so nobody deletes them as unused.
6. **Analytics naming:** delete the three `canvas_*` helpers (recommended), and name the masonry events in the EP-21 spec (`canvas_` prefix would mislead). The planning chat should check PostHog insights built on `canvas_tile_click`.
7. **`pickLargestImage` placement:** the tour page's image picker lives in `apps/api/src/canvas/canvas-image.ts`, so `experiences/` depends on `canvas/`. *Recommendation:* leave in place in this PR (feed module stays); move it when the module is renamed for EP-21. Spec 0005 `:89` names the current path.
8. **`geometry.ts` after trimming:** keep the filename and location (recommended; no churn in the barrel or the API specs) or rename to something feed-shaped (for example `canvas/buckets.ts`) in this PR?
9. **`campaign=canvas-tour`** (`tour-go.ts:14`, spec 0005 AC-9, `viator-url.spec.ts`): affiliate attribution string. *Recommendation:* keep the value unchanged so reporting stays continuous; confirm no change is wanted.
10. **`CanvasItem.tsx` caption:** extract nothing (recommended; masonry tile design is undecided) or lift the meta-line composition (`CanvasItem.tsx:122-131`: duration · price · rating) into `lib/format.ts`? Roy's call.
11. **Stale scope rows (not part of this PR):** row 17 (`robots.txt` rating path) says `planned` though `Disallow: /api/canvas/` shipped in #116; "Build it" boxes for rows 12-16 are unticked though the code shipped. `/sync` or the planning chat should reconcile; the removal PR will only touch statuses of rows 13-15.
12. **Vercel dashboard:** any redirect, rewrite or header for `/discover` set outside the repo cannot be seen from here. The planning chat should check it (and PostHog) as noted in Step 5.
