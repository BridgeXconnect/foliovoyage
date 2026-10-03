# 0004. Discovery canvas: rationale

The decision record for [index.md](index.md). The build does not read this file.

## Context

Atlas needs a top of funnel surface that works for people who do not yet know what to search for. The design answer (the canvas design brief and the 1 Oct decisions, with the Paper file `01M3VHFY502GXVVB8RJ9VW1QBH`) is a Pinterest style wall: tours at fixed positions, clustered by city and category, panned freely in every direction, with no zoom. There are 6 curated cities and 7 shown categories, so 42 buckets.

The data is taxonomy based. Tours have no usable latitude and longitude (BRI-217), so position comes from the bucket, not a map. Each tour has one primary category (`Tour.primaryCategoryTagId`, BRI-224, "rarest root wins" over eight Viator root tags), indexed for exactly this feed. Two root categories are out: Travel & Transportation Services (airport transfers, private drivers) and tours with no primary category.

Three facts about the current repo shape the design. No feed code exists, and the search and destination endpoints take no category filter. The only tour detail page and the `/go` affiliate redirect serve hand authored static content, so a tour that lives only in the database has no page to open. And `@folio/shared` is consumed as TypeScript source by `apps/web` (through `transpilePackages`) but the CommonJS api imports only its types, so shared runtime code cannot be called from the api today.

Deciding nothing here means the four features get built against different assumptions about positions, sizes, and caption heights, and the layout drifts between client and server.

## Options considered

### Option 1: Fixed scale world, section culler, pure shared layout, two endpoint feed

Positions are fixed in one world. A pure function in `@folio/shared` places tiles. The page mounts only the sections near the view. A two endpoint feed (summaries, then one bucket) serves the data.

**Pros**:
- Deterministic positions, so shared links, the minimap, and tests are exact.
- Cheap culling: finding visible sections is arithmetic.
- No schema change.

**Cons**:
- Hand rolled pan and culler is real code to build and test.
- The world is large (28,800 by 6,496 px) and needs a performance spike to confirm it holds 60 fps on a phone.

### Option 2: Virtualised scrolling grid

Use `@tanstack/react-virtual` for a two dimensional grid with native scroll.

**Pros**:
- Library, less custom code, native scroll momentum.

**Cons**:
- Fits a uniform grid, not a clustered wall with tilted tiles and reserved corners.
- Free pan in both axes with fixed bucket positions is awkward, and a minimap needs positions the library does not expose.

### Option 3: Canvas or WebGL renderer

Draw tiles on a canvas element with a scene library.

**Pros**:
- Handles very large tile counts.

**Cons**:
- Tiles need real links, text, and accessibility. A canvas loses all three and adds a heavy dependency for at most about 150 visible tiles.

### Option 4: Compute layout on the server

The api lays out each bucket and returns coordinates.

**Pros**:
- One layout per bucket, cacheable, clients stay thin.

**Cons**:
- The api cannot load the shared ESM package at runtime today, so it would need a duplicate layout or a build change first.
- Ties the visual to an API release.

## Rationale

Option 1 fits the forces in Context. The surface is a wall you wander, with fixed positions and no zoom, so arithmetic culling of 512 px sections is simple, predictable, and cheap, and a position is just a bucket plus an offset. The mounted tile budget (about 150) is far below what the DOM handles, so a canvas renderer (Option 3) would cost accessibility and links for no gain. A virtual grid (Option 2) assumes a uniform grid, which this layout is not.

Putting the layout in `@folio/shared` as a pure function with fixed caption heights keeps it independent of fonts and devices. Option 4 is attractive later for share cards, but the api cannot load that package today, so it is a Follow-up, not a blocker, and `apps/web` is the only consumer for now.

Ranking runs in SQL per request with a Bayesian weighted rating (the average shrunk toward the bucket mean by how many ratings it has), tie broken on id, unrated last. A stored rank would be a derived value that goes stale, and there is no measured performance problem, so no migration. At 60 tiles per bucket nothing is paged, which removes cursor logic and the stale ticket text about it.

The position URL is bucket relative so that a later change to slot size or arrangement does not break links already shared. The cost is a small lookup on load.

The performance spike runs first inside the layout and rendering work because the whole design depends on the pan holding 60 fps, and finding out after the full build would be expensive. The mobile and performance pass is the gate before slice 2.

## Step 0 evidence

What the repo check found before the interview (so the spec's claims can be traced):

- **BRI-225**: Backlog, last edited 27 Sep, text stale (cursor pagination, price band, real image width and height). No canvas or feed code exists in `apps/api/src`. Controllers exist only for affiliate, destinations, health, readiness, and search.
- **Category data**: `Tour.primaryCategoryTagId Int?` with `@@index([primaryCategoryTagId])`, commented as the canvas feed (BRI-225) index. It is populated at ingest by a category resolver plus a backfill CLI. Whether the production backfill ran was not verified.
- **No category filtered city page**: `/destinations/[slug]` takes no query parameters. `/search` filters on nine hand authored `ExperienceCategory` values, not Viator roots, and has no city scope. Hence the exit tile goes to the unfiltered city page.
- **Detail page and `/go`**: `apps/web/src/app/destinations/[slug]/experiences/[experienceId]/page.tsx` is static with `dynamicParams = false`, built from `destinations.ts`. `apps/web/src/app/go/[slug]/[id]/route.ts` resolves through static data and returns 404 for an unknown key. DB tours have neither.
- **`@folio/shared`**: `package.json` points `main`, `types`, and `exports` at `./src/index.ts`, no build step, dependency `zod`. `apps/web` uses `transpilePackages`. `apps/api` imports types only.
- **Web styling**: the only Tailwind 4 `@theme` block is in `apps/web/src/app/globals.css`. It has the brand colours, radii, fonts, and `--container-content`. The Paper tokens `--container-caption-sm/md/lg`, `--container-panel`, `--leading-xs`, and `--leading-sm` are missing. Tailwind's own `--leading-tight`, `--text-lg`, and `--text-base` differ from Paper's and need an explicit override. `--container-*` feeds width utilities, so caption heights need `h-(--container-caption-md)` or an inline style.
- **Analytics**: `posthog-js` is initialised in `apps/web/instrumentation-client.ts`, with helpers in `apps/web/src/lib/analytics.ts`. There is a site password gate in `middleware.ts` and `robots.ts` disallows `/go/` only.
- **Client fetch**: `API_BASE_URL` is server only and the api has no CORS, so the client needs a web side proxy route.
- **Layout prototype**: `~/dev/canvas-Gallery/atlas-cluster/cluster.mjs` (canvas-Gallery commit `2a132ba`). One 60 tour bucket (15 at 1:1, 45 at 3:2, artboard 2400 by 1624, exit tile at (2112, 1416)) measured a minimum clearance of 10.61 px against the 6 px rule. One sample of one bucket.

## Open design items carried from the interview

Decided in the interview: 60 tiles per bucket, exit tile to the unfiltered city page, tile click to a new DB tour page, tiers 4, 16, 40, explicit caption heights, ranking in SQL cached, shared layout in web only for now, the 4 by 2 city region, bucket relative position URL, the brief's Recommended items as written, the two endpoint feed, and no migration.

Decided here without a separate question (for you to accept or change): the layout property test (many buckets and seeds, 1 to 60 tiles, small buckets included), the placement of the performance spike as the first task of the layout child, and the 9 separators as an open item for the designer.
