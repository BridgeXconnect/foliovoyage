# 0004. Canvas feed endpoint (child of 0004 discovery canvas)

Scope row 12, BRI-225. Governed by [index.md](index.md): world geometry, shared types, and the cross child contract live there.

## Summary

The canvas reads two public endpoints. The first returns a small summary of all 42 city and category buckets for first paint. The second returns one bucket's best 50 tours, ranked, plus the true total for the exit tile. Ranking happens in SQL on each cache miss, so there is no migration and no stored rank. Both endpoints are cached, and nothing is paged because a bucket never exceeds 50 tiles.

## Requirements

**User stories**:
- As the canvas page, I want 42 bucket summaries in one call so that the first paint knows every region's label, count, and picture.
- As the canvas page, I want one bucket's ranked tiles on request so that I load only what is near the view.
- As Roy, I want the feed to apply the exclusion rules and rank well so that the wall shows good, bookable tours only.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-F1**: `GET /v1/canvas/buckets` returns up to 42 summaries, one per bucket that has at least one eligible tile, with `citySlug`, `countrySlug`, `cityName`, `categorySlug`, `categoryLabel`, `total` (the count of eligible tiles, uncapped), and `image` (the cover image of the bucket's rank 1 tile). A bucket with no eligible tile is left out. The list order is the fixed world order from index.md.
- **AC-F2**: `GET /v1/canvas/buckets/:citySlug/:categorySlug` returns the bucket summary fields plus `tiles`, at most 50, in rank order with `rank` starting at 1. An unknown city slug, an unknown category slug, or a bucket with no eligible tile returns 404 `application/problem+json`.
- **AC-F3**: A tour is eligible only when `deletedAt` is null, `primaryCategoryTagId` is one of the seven shown categories (21909, 21910, 21911, 21912, 21913, 21915, 21916), its Experience has `status = "published"` and belongs to a city in the shared geometry list (matched on `countrySlug` plus `slug`, see index.md), it has a usable image (AC-F7), and `priceReferenceMinor` is not null. Category 21914 and a null category are never returned.
- **AC-F4**: One tile per Experience within a bucket. When an Experience has several eligible tours, the tile uses the tour with the best score, ties broken by the lowest Tour `id`.
- **AC-F5**: Within a bucket, tiles are ordered by Bayesian score descending: `(v / (v + m)) * R + (m / (v + m)) * C`, where `R` is the tour's `ratingAvg`, `v` its `ratingCount`, `C` the mean `ratingAvg` of the bucket's rated eligible tours, and `m` = 10. `C` is computed over all eligible rated tours in the bucket, before the one tile per Experience step. A tour counts as unrated when `ratingAvg` is null or `COALESCE(ratingCount, 0) = 0`, and ranks after every rated tour. Ties, rated or not, break on Tour `id` ascending with `COLLATE "C"` (ids are text). The score is computed in SQL, never stored.
- **AC-F6**: A tile carries `id` (the Experience id), `tourId` (the chosen Tour id, so a click can be attributed to a tour), `rank`, `title`, `image {url, width, height}` (width and height are `null` when unknown), `durationMin`, `price {amountMinor, currency}` (`amountMinor` from `priceReferenceMinor`, a `BigInt` sent as a JSON number and checked as an integer in the Zod schema, `currency` from `priceReferenceCurrency`), `ratingAvg`, and `ratingCount`. It carries no `aiSummary`, no affiliate URL, and no tags.
- **AC-F7**: In SQL, a tour has a usable image when `Tour.images` has an entry with at least one variant URL, or `imageUrl` is not null. The variant is picked in code, so the SQL stays one query (AC-F10). The entry is the one with `isCover`, else the first entry. Within it, pick the smallest variant at least 480 px wide for an `sm` rank (21 to 50), at least 640 px for `md` and `lg`, else the widest variant, skipping variants with width 0, else `Tour.imageUrl`.
- **AC-F8**: Responses carry `Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400` and are also held in an in process cache for 10 minutes per bucket, so repeated requests do not reach the database.
- **AC-F9**: Every response body parses against the Zod schemas in `@folio/shared` (`packages/shared/src/api.ts`). Errors use the existing `ProblemDetailsFilter` (RFC 9457). The routes are versioned under `/v1`.
- **AC-F10**: A bucket request runs one query (the join, filter, and rank together), and the summaries request runs one grouped query, not 42.

## Decision

**Chosen option**: Option 1: Two endpoints, one DB read each, ranking in SQL, cached.

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Endpoint shape | `/v1/canvas/buckets` plus `/v1/canvas/buckets/:citySlug/:categorySlug` | First paint needs summaries only. Tiles load on demand | One endpoint returning every tile |
| Bucket key | City slug and category slug from a constant map in `@folio/shared` | The map is the one list of the 7 shown categories and their root tag ids | Query by raw tag id |
| Paging | None, hard cap of 50 | The wall shows the best 50. No cursor logic | Cursor pagination (the old BRI-225 text) |
| Ranking | Bayesian score with prior weight `m` = 10 in SQL per request, cached | No migration, no stale stored rank | A stored rank column |
| Price on the tile | `priceReferenceMinor` with its `priceReferenceCurrency` | Ranking and display need one comparable currency | Local `priceMinor` and `currency` |
| Data model | No schema change, no migration | `primaryCategoryTagId` is already indexed for this feed | Add a bucket table |

## Feature design

**Data model sketch**: no new tables or columns. Reads `Tour` (`id`, `title`, `durationMin`, `ratingAvg`, `ratingCount`, `priceReferenceMinor`, `imageUrl`, `images`, `primaryCategoryTagId`, `experienceId`, `deletedAt`), `Experience` (`id`, `status`, `cityId`), and `City` (`id`, `slug`, `countrySlug`, `name`). The index `Tour.primaryCategoryTagId` carries the bucket filter.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/v1/canvas/buckets` | GET | none | `buckets[]` of summaries (AC-F1) | public | 500 problem+json |
| `/v1/canvas/buckets/:citySlug/:categorySlug` | GET | `citySlug`:string (req), `categorySlug`:string (req) | summary fields plus `tiles[]` (AC-F2, AC-F6) | public | 404 unknown or empty bucket |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Summaries | `categoryLabel`, `categorySlug` | the constant map in `@folio/shared`, keyed by `primaryCategoryTagId` |
| Summaries | `total` | `count` of eligible tours grouped by Experience, per bucket |
| Summaries | `image` | the rank 1 tile's image (AC-F7) |
| Bucket | `rank` | position in the Bayesian ordering (AC-F5) |
| Bucket | `price` | `Tour.priceReferenceMinor` (as a number) and `Tour.priceReferenceCurrency` |
| Bucket | `tourId` | the chosen `Tour.id` (AC-F4) |
| Both | `cityName` | `City.name` |
| Bucket | `image.width`, `image.height` | the chosen variant's `width` and `height`, `null` when 0 or from `imageUrl` |
| Bucket | `id` | `Experience.id` |
| Bucket | `C` and `m` | `C` computed per request over the bucket, `m` a code constant (10) |
| Both | city and country slugs | `City.slug`, `City.countrySlug` |

**Key invariants**:
- The seven shown categories and the excluded 21914 are defined once, in `@folio/shared`.
- A response never contains more than 50 tiles or two tiles for one Experience.
- Rank is a pure function of the data, so two requests for unchanged data return the same order.

**Security model**: public, read only, no user data. No auth. The response holds nothing private (no affiliate URL, no `aiSummary`). The in process cache bounds database load whatever the request rate.

**Configuration required**: none. `m` = 10 and the 50 cap are code constants.

**Critical test scenarios**:
- Happy path: a seeded Bangkok bucket returns tiles in score order with ranks 1 to N, verifies **AC-F2**, **AC-F5**
- Failure case: unknown category slug and an empty bucket both return 404 problem+json, verifies **AC-F2**
- Edge: category 21914, a null category, a soft deleted tour, a tour without a price, and a tour without an image are all absent, verifies **AC-F3**
- Edge: two tours in one Experience give one tile, the better one, verifies **AC-F4**
- Edge: unrated tours rank after rated ones, ordered by id, verifies **AC-F5**
- Contract: a response parses with the shared Zod schema, verifies **AC-F9**
- Cache: a second request inside 10 minutes issues no query, verifies **AC-F8**

## Build plan

1. Add the category map and the feed Zod schemas to `@folio/shared`, satisfies **AC-F1**, **AC-F2**, **AC-F6**, **AC-F9**
2. Build the bucket query (join, filter, Bayesian rank, image pick) and the summaries grouped query, satisfies **AC-F3**, **AC-F4**, **AC-F5**, **AC-F7**, **AC-F10**
3. Add the controller, the 404 problem responses, and the cache headers and in process cache, satisfies **AC-F1**, **AC-F2**, **AC-F8**, **AC-F9**
4. Add integration tests against the seeded database, satisfies **AC-F3** to **AC-F5**
5. Update BRI-225's text to match this spec (a housekeeping task, no AC)

## Consequences

**Positive**:
- First paint is one small cached call. Each bucket is a single query.
- No migration, so the endpoint can ship before any data change.

**Negative / tradeoffs**:
- Ranking is recomputed on each cache miss. With 42 buckets and a 10 minute cache that is cheap, but a cold start refills 42 queries.
- The Bayesian prior `m` = 10 is a judgment call. It can be tuned in one place once real ratings are seen.
- `priceReferenceMinor` may be null for some live tours, which drops them from the canvas (AC-F3).

**Neutral**:
- The api holds no rate limit today. The in process cache bounds database load, and an edge limit is a Follow-up.

## Follow-up

- [ ] Add an edge or app level rate limit for the two public endpoints (the api has none today).
- [ ] After BRI-224's backfill is confirmed on production, check the bucket counts look sane (no bucket under about 15 tiles for the six cities).
- [ ] The category slug and label map has an API local copy (`apps/api/src/canvas/canvas-categories.ts`), pinned to the shared copy and to `category-rule.ts` by a parity test, because the API compiles to CommonJS and cannot import values from `@folio/shared` yet. AC-1's "defined once" applies to slot geometry, which only `@folio/shared` holds. Remove the copy when `@folio/shared` gets a dual build or a CommonJS entry.

## Rationale

The canvas needs two different things: a cheap overview and a bucket on demand. One endpoint for both would either ship 2,500 tiles up front or force a second call anyway. With a hard cap of 50 per bucket there is nothing to page, so cursor pagination from the old ticket would be dead code. Ranking in SQL on a cache miss avoids a stored column that goes stale and needs a migration for no measured gain. Using the Experience id as the tile id gives the layout a stable seed and gives the tile target page one key.
