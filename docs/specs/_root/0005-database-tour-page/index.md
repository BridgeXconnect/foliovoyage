# 0005. Database tour page

**Date**: 2026-10-04
**Status**: Proposed

## Summary

A canvas tile for a tour that lives only in the database has no page to open today, so this spec adds one: `/tours/:experienceId`. It shows the tour's title, cover image, price, duration, cancellation policy, and a short text, plus one button that logs the click on our server and sends the visitor to Viator. The star rating is protected content under Viator's rules, so it never appears in the page source: a small script under a path blocked in `robots.txt` loads it after the page renders. The page is `noindex` (hidden from search engines) until AI copy and the editorial stamp exist, it adds no migration and no new environment variables, and the canvas switches to it with a one line change in `tourHref`.

## Requirements

**User stories**:
- As a visitor on the canvas, I want a tile to open a page about that tour so that I can decide whether to book it.
- As a visitor, I want one clear button that takes me to Viator so that I can check dates and book.
- As a visitor, I want a link back to the spot on the canvas I came from so that browsing does not lose my place.
- As Roy, I want every booking click logged on our server and in PostHog, and the page to follow Viator's content rules, so that revenue is measurable and the affiliate account stays safe.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: `GET /v1/experiences/:id` returns the page data for a published Experience with at least one live Tour (`deletedAt` null): `experienceId`, `tourId`, `title`, `image {url, width, height, alt}` or `null` (`width` and `height` are `null` when unknown), `durationMin`, `price {amountMinor, currency}` or `null`, `cancellationDescription` or `null`, `summary {kind: "ai" | "provider", text}` or `null`, `affiliateUrl` or `null`, and `city {slug, countrySlug, name}`. It returns no rating field. The Tour used is the live Tour with the lowest `id`.
- **AC-2**: `GET /v1/experiences/:id/rating` returns `{ratingAvg, ratingCount}` (each a number or `null`) for the same Tour as AC-1.
- **AC-3**: Both endpoints return 404 `application/problem+json` through `ProblemDetailsFilter` when the Experience does not exist, is not `published`, or has no live Tour, with a different `detail` for each case. Every response from both, 404s included, carries `Cache-Control: public, s-maxage=900, stale-while-revalidate=86400`, set by the controller. Both bodies parse against Zod schemas in `@folio/shared` (`packages/shared/src/api.ts`).
- **AC-4**: `/tours/:experienceId` renders the title (from `Tour.title`), the cover image, the price as "From {formatted price}" (no per person label) with the note "Final price shown by Viator at booking.", the duration, the cancellation text exactly as stored, the summary text, an affiliate disclosure link to `/legal/disclosure`, and one "Book on Viator" button. A missing price, image, duration, cancellation text, or summary hides that element only; the button always shows.
- **AC-5**: The summary is the AI copy when `resolveAiSummary` returns it (published, grounding hash still valid, Tour still eligible), else the provider `Tour.description` as plain text: tags removed, entities decoded, `<br>` and `<p>` turned into paragraph breaks, rendered as paragraphs with no truncation. When nothing is left after stripping, `summary` is `null` and nothing shows. The page never shows both.
- **AC-6**: No rating value (average or count) appears anywhere in the server HTML, the RSC payload, or any inline script of `/tours/:experienceId`. The rating appears only after `/protected/tour-rating.js` loads in the browser and fetches `/protected/tours/:experienceId/rating.json`. A small client component injects that script on every mount, so a client side navigation to a second tour page also gets its rating. `robots.txt` disallows `/protected/` in both gate states: the gated branch already returns `disallow: /`, and the open branch gets an explicit `/protected/` rule.
- **AC-7**: The page is `noindex, nofollow` (`metadata.robots {index: false, follow: false}`) and absent from `sitemap.xml`.
- **AC-8**: An unknown, unpublished, or tourless `experienceId`, or one that is not a cuid, renders a 404 page (HTTP status 404) with a link back to `/discover`. The page calls `notFound()` only on an api 404 or a failed id check. An api 5xx or network error throws, so ISR keeps serving the last good page instead of caching an error.
- **AC-9**: `GET /go/tours/:experienceId` logs an `AffiliateClick` with `tourId` set to the database `Tour.id`, then redirects 302 to `affiliateUrl` with `campaign` set to `canvas-tour` through `URL.searchParams.set` (replacing any existing `campaign`, every other part unchanged), with `Cache-Control: no-store` and `X-Robots-Tag: noindex`. It only redirects to an `https` URL whose host is `viator.com` or ends with `.viator.com`.
- **AC-10**: When `affiliateUrl` is `null` or not a Viator URL, `/go/tours/:experienceId` redirects to `buildProviderFallbackUrl(city.slug, links, extractAccountAffiliateParams(links))`, where `links` is the static `viator-links.json` import. That gives the Viator destination page when the static registry knows the city, else the account root page (both with `campaign=affiliate-fallback`). It logs the click with `providerId` `viator-search-fallback`, and the page button reads "Search on Viator" instead. An unknown or malformed `experienceId` returns 404 and logs nothing.
- **AC-11**: The click log POST is awaited for at most 1.5 seconds. On timeout or error the redirect still happens and the failure goes to `console.error`. The visitor never sees an error because of the ledger.
- **AC-12**: `/go/tours/...` reaches the new route, never `/go/[slug]/[id]`, and no destination slug in `destinations.ts` equals `tours`. A test pins both.
- **AC-13**: The back link reads "Back to {City} · {Category}" and points to `/discover?at=<city>.<category>` when the page URL carries a `from` value (split on the first dot, `<citySlug>.<categorySlug>`) whose city equals the tour's `city.slug` and whose category is in `CANVAS_CATEGORIES`. Otherwise it reads "Back to {City}" and points to `/destinations/:citySlug`.
- **AC-14**: `canvas_tile_click` gains `experience_id` and `tour_id`. A new `tour_page_viewed` event fires once per mount (guarded against the strict mode double run) with `{experience_id, tour_id, city, category, from}`. The button fires `experience_booking_clicked` through `trackAffiliateClick` with `experience_id` and `source: "tour_page"`. All three go through helpers in `apps/web/src/lib/analytics.ts`, never an inline `posthog.capture`.
- **AC-15**: The page uses ISR (incremental static regeneration: built on first request, then served from cache and rebuilt in the background) with `revalidate = 900`. The page itself reads no request data (no `searchParams`, cookies, or headers on the server), so it stays cacheable. Its api fetch uses `next: { revalidate: 900 }`, and `generateMetadata` makes the identical fetch so Next dedupes it. Any id that passes the cuid check may create a cache entry, which is accepted.
- **AC-16**: `tourHref` returns `/tours/${tile.id}?from=${citySlug}.${categorySlug}`, a unit test pins it, and a click on a canvas tile in a production build opens the tour page.
- **AC-17**: On an iPhone 16 with a production build (the 0004 AC-L9 method, Low Power Mode off): tile to page to button to Viator works, the back link returns to the canvas, and the rating appears.

## Decision

**Chosen option**: Option 1: An ISR page at `/tours/:experienceId` fed by two public API endpoints, with the rating loaded by a robots blocked script and clicks logged by a dedicated `/go/tours` redirect.

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Route | `/tours/:experienceId` | Short, not tied to a city, keyed on the same id the canvas tile carries | `/destinations/:city/tours/:id` |
| Key | `Experience.id` | The canvas tile id is the Experience id. The schema allows several Tours per Experience, so the page picks one | `Tour.id` |
| Which Tour | Live Tour with the lowest `id` | Same rule as `resolveAiSummary` and the destination read, so the AI copy always matches the Tour shown | The canvas feed's best scoring Tour |
| Indexing | `noindex` until AI copy plus the editorial stamp | Thin provider text would be a duplicate content page. The flip is per page, in a later ticket | Index from day one |
| Rating | Loaded in the browser by `/protected/tour-rating.js`, path blocked in `robots.txt` | Viator's rule: protected content never in page source, loaded by an external script that is itself blocked. `noindex` alone does not satisfy it | Leave the rating out entirely |
| Body text | AI copy replaces the provider description when valid | One text block, no duplication, the AI copy is the reason the page will later be indexed | Show both |
| Fields | Title, cover image, price, duration, verbatim cancellation text, summary text | The minimum to decide, and each is a standard field Viator allows | Add inclusions, exclusions, gallery |
| Price | `priceMinor` with `currency`, as returned | Viator requires price to stay live and unmodified. Converting would modify it | `priceReferenceMinor` in USD (the canvas tile price) |
| Button | `/go/tours/:experienceId` | Logs every click on our server before leaving, the same pattern as `/go/[slug]/[id]` | Link straight to Viator and log only in PostHog |
| Missing link | The existing Viator fallback (destination page, else account root) | Keeps the visitor moving and keeps attribution | Hide the button |
| Click log wait | Await, abort after 1.5 seconds | Ledger completeness without letting a slow api block the visitor | Fire and forget |
| Back link | `?from=<city>.<category>` read in the browser | Returns to the bucket. Reading it in the browser keeps the page ISR | Browser history back |
| Caching | ISR, 15 minutes, matching `s-maxage=900` on the api | Price and availability change daily at most. Cheap at any traffic | `force-dynamic` with `no-store` (the existing DB page pattern) |
| API shape | Two endpoints, page data and rating | The rating must travel a separate, robots blocked route | One endpoint with the rating inside |
| Not found | A real 404 with a link to `/discover` | Clear for visitors and crawlers | Redirect to the city page |
| Data model | No change, no migration, no new environment variables | Every field already exists on `Tour`, `Experience`, `TourCopy`, `AffiliateClick` | Store a chosen Tour per Experience |

## Feature design

**Data model sketch**: no new tables, columns, or migration. Reads:
- `Experience` (`id` cuid, `status` `"draft"` or `"published"`, `cityId`, `tours`).
- `Tour` (`id`, `title`, `description?`, `durationMin?`, `ratingAvg?`, `ratingCount?`, `priceMinor BigInt?`, `currency?`, `affiliateUrl?`, `imageUrl?`, `imageAlt?`, `images Json`, `cancellationPolicy Json?`, `experienceId?`, `deletedAt?`). `cancellationPolicy` has the shape `{type, description, refundTiers, cancelIfBadWeather, cancelIfInsufficientTravelers}`, and only `description` is used.
- `TourCopy` through `resolveAiSummary` (no change to that function).
- `City` (`slug`, `countrySlug`, `name`).
- Writes `AffiliateClick` (`tourId` text, `providerId`, `sessionId?`, `referrer?`, `userAgent?`, `ipHash?`) through the existing `POST /v1/affiliate-clicks`. `AffiliateClick.tourId` already holds either a static `"slug/id"` key or a database `Tour.id`. This page writes the second form, which is what search popularity joins on.

Dev counts (read only, 2026-10-04): 846 Experiences (845 published), no Experience with more than one Tour, 6 Experiences with no live Tour, 840 live linked Tours all with a Viator `affiliateUrl` and a `cancellationPolicy`, 1 published `TourCopy`.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/v1/experiences/:id` | GET | `id`:string (req) | AC-1 fields, no rating | public | 404 unknown, unpublished, or no live Tour |
| `/v1/experiences/:id/rating` | GET | `id`:string (req) | `ratingAvg`, `ratingCount` | public | 404 as above |
| `/v1/affiliate-clicks` (existing) | POST | `tourId`, `providerId`, `referrer?`, `userAgent?`, `ip?` | 201 | `x-internal-secret` | 401 wrong secret |
| web `/tours/:experienceId` | GET | path id | the page | public | 404 page |
| web `/go/tours/:experienceId` | GET | path id | 302 to Viator | public | 404 unknown id |
| web `/protected/tours/:experienceId/rating.json` | GET | path id | `{ratingAvg, ratingCount}` | public, robots blocked | 404 problem+json |
| web `/protected/tour-rating.js` | GET | none | static script | public, robots blocked | none |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Page data | `title` | `Tour.title` of the chosen Tour (not `Experience.title`) |
| Page data | `image.url`, `width`, `height` | `Tour.images` through the canvas image picker (`apps/api/src/canvas/canvas-image.ts`) with a new constant `MIN_WIDTH_PAGE = 1024`, else the widest variant, else `Tour.imageUrl`. `width` and `height` are `null` when unknown |
| Page data | `image.alt` | `Tour.imageAlt`, else `Tour.title` |
| Page | image element | `next/image` when the host matches `**.tripadvisor.com` (allowed in `next.config`) and both dimensions are known, else a plain `<img>` with a fixed aspect ratio box. Loaded with priority (it is the main image) |
| Page data | `price` | `Tour.priceMinor` (sent as a JSON integer) and `Tour.currency`. `null` when either is null |
| Page | formatted price | `formatPrice(amountMinor, currency)` from `apps/web/src/canvas/format.ts` (already handles each currency's minor unit), shown with a capital "From" |
| Page data | `durationMin` | `Tour.durationMin`, formatted by `formatDuration` from `apps/web/src/canvas/format.ts` |
| Page data | `cancellationDescription` | `Tour.cancellationPolicy.description` exactly as stored, `null` when absent or not a string. Never built from `refundTiers` |
| Page data | `summary` | `resolveAiSummary` (kind `ai`), else `Tour.description` stripped as in AC-5 (kind `provider`), else `null` |
| Page | `<title>`, meta description | `{title} · Atlas`, and the first 155 characters of the summary text (omitted when `summary` is `null`). No Open Graph tags while the page is `noindex` |
| Page | price note, disclosure | "Final price shown by Viator at booking." and the existing link to `/legal/disclosure` |
| Page data | `affiliateUrl` | `Tour.affiliateUrl` |
| Page data | `city` | the Experience's `City` |
| Rating | `ratingAvg`, `ratingCount` | `Tour.ratingAvg`, `Tour.ratingCount` of the same chosen Tour |
| Redirect | target URL | `affiliateUrl` with `searchParams.set("campaign", "canvas-tour")`, else `buildProviderFallbackUrl(city.slug, links, extractAccountAffiliateParams(links))` from `apps/web/src/lib/affiliate-fallback.ts`, `links` being the static `viator-links.json` import (destination page or account root) |
| Redirect | experience data | the same api fetch as the page, `next: { revalidate: 900 }`, so `affiliateUrl` can be up to 15 minutes stale (accepted) |
| Redirect | click row `tourId` | `tourId` from the page data |
| Redirect | click row `providerId` | `"viator"`, or `"viator-search-fallback"` on the fallback |
| Redirect | `referrer`, `userAgent`, `ip` | request headers, as in `/go/[slug]/[id]`. No `sessionId`, same as that route |
| Page | back link label and target | `from` read in the browser, split on the first dot, accepted only when its city equals the tour's `city.slug` and its category is in `CANVAS_CATEGORIES` (`@folio/shared`). City name from page data, category label from the shared category map |
| Web routes | id check | a cuid pattern (`/^c[a-z0-9]{20,32}$/`) checked before any fetch, plus `encodeURIComponent` in every api URL. A failing id is a 404 |
| Page | button label | "Book on Viator" when `affiliateUrl` is a Viator URL, else "Search on Viator" (same check as the redirect) |
| `tour_page_viewed` | `category` | the category part of `from`, `null` when `from` is absent or invalid |
| `canvas_tile_click` | `experience_id`, `tour_id` | the tile's `id` and `tourId` (already on `CanvasTile`) |

**Key invariants**:
- No rating value ever appears in server rendered output of `/tours/*` (AC-6).
- The page and the redirect pick the same Tour for an Experience, because both read the same endpoint.
- The redirect target host is always `viator.com` or a subdomain of it, over `https`.
- `affiliateUrl` is used verbatim. Only `campaign` is appended (allowed by Viator: alphanumeric and dashes).
- Price, cancellation text, and availability are never altered or rewritten.
- The page server code reads no request data, so ISR holds.
- No web route sends a path id to the api without the cuid check and encoding.
- The new route uses a strict host check (`viator.com` or a subdomain, `https`), not the `endsWith("viator.com")` helper in `/go/[slug]/[id]`.

**How the rating loads**: `apps/web/public/protected/tour-rating.js` is a plain script of about 1 KB with no build step. The page renders an empty element `<div data-tour-rating data-experience-id="…"></div>` and a small client component that, on every mount, appends `<script src="/protected/tour-rating.js">` (or, when the script is already loaded, calls the `window.atlasTourRating()` function it defines). The script fills every unfilled `[data-tour-rating]` element. It fetches `/protected/tours/<id>/rating.json`, and when `ratingCount` is above 0 writes the average and the count into the element as text (the same `★ 4.8 (1,234)` form as `formatRating` in `apps/web/src/canvas/format.ts`, copied into the script because it has no build step). On any failure, including a non JSON response (the gate rewrites `/protected/*` to `/coming-soon` without the preview cookie), it leaves the element empty. The JSON route is a Next route handler that proxies `GET /v1/experiences/:id/rating` with `next: { revalidate: 900 }` and responds with `Cache-Control: public, s-maxage=900, stale-while-revalidate=86400` and `X-Robots-Tag: noindex`.

**Security model**: everything is public and read only except the click POST, which stays server to server with `x-internal-secret` (`INTERNAL_CLICK_SECRET`), never exposed to the browser. The IP is salted and hashed by the api, as today. The redirect allow list (Viator host, `https`) prevents an open redirect even if a bad URL reached the database. No user data is stored beyond the existing click ledger. The new public endpoints have no rate limit, the same as the canvas feed. CDN caching bounds load, and a rate limit is a Follow-up.

**Configuration required**: none new. Reuses `API_BASE_URL` (web, server only) and `INTERNAL_CLICK_SECRET` (web and api, same value).

**Critical test scenarios**:
- Happy path: a seeded published Experience returns AC-1 fields, the page renders them and the button, and the redirect logs a click with the database `Tour.id` and returns 302 to the Viator URL plus `campaign`, verifies **AC-1**, **AC-4**, **AC-9**
- Contract: both api responses parse with the shared Zod schemas, verifies **AC-3**
- Not found: an unknown id, a draft Experience, and an Experience whose only Tour is soft deleted each return 404 with its own `detail`, and the page renders the 404 page, verifies **AC-3**, **AC-8**
- Protected content: the HTML and RSC payload of a rated tour contain neither the average nor the count, `robots.txt` disallows `/protected/` with the gate on and off, and the rating fills after a client side navigation to a second tour, verifies **AC-6**
- Summary: valid AI copy replaces the description, a stale grounding hash falls back to the description, markup in the description is stripped, verifies **AC-5**
- Fallback: a null and a non Viator `affiliateUrl` both redirect with `viator-search-fallback` (to the destination page for a city in the static registry, to the account root for one that is not), and the button reads "Search on Viator", verifies **AC-10**
- Campaign: a URL that already has `campaign=x` ends with exactly one `campaign=canvas-tour`, and `evilviator.com` is refused, verifies **AC-9**
- Error handling: an api 500 throws instead of rendering the 404, and a malformed id 404s without a fetch, verifies **AC-8**
- Ledger timeout: a click POST that hangs past 1.5 seconds still produces the redirect and a `console.error`, verifies **AC-11**
- Routing: `/go/tours/x` hits the new handler, and no destination slug is `tours`, verifies **AC-12**
- Back link: a valid `from` links to `/discover?at=…`, while a missing one, an invalid one, or one naming another city links to the city page, verifies **AC-13**
- Indexing: the page has `noindex, nofollow` and the sitemap has no `/tours/` URL, verifies **AC-7**
- Swap: `tourHref` returns the new URL, verifies **AC-16**

## Build plan

The build approach is Tracer Bullet: one thin thread from the database to Viator first, then thicken.

1. Add `experiencePageSchema` and `experienceRatingSchema` to `@folio/shared` with contract tests, satisfies **AC-3**
2. Add the api `experiences` module: `GET /v1/experiences/:id` (lowest id live Tour, price, image pick with `MIN_WIDTH_PAGE`, verbatim cancellation, summary through `resolveAiSummary`, the AC-5 description stripper), the three 404 cases through `ProblemDetailsFilter`, and the cache header on every response, with unit and integration tests, satisfies **AC-1**, **AC-3**, **AC-5**
3. Add `apps/web/src/app/tours/[experienceId]/page.tsx` with ISR (`revalidate = 900`, `dynamicParams` true, no `generateStaticParams`), the cuid check, `notFound()` on an api 404 only, `noindex` metadata and title, placeholder styling only, the fields with their hide rules, the disclosure link, and the button, satisfies **AC-4**, **AC-7**, **AC-8**, **AC-15**
4. Add `apps/web/src/app/go/tours/[experienceId]/route.ts`: cuid check, strict Viator host check, `campaign` set, city search fallback, click POST awaited with a 1.5 second abort, 302 with `no-store` and `X-Robots-Tag: noindex`, plus the routing priority test and the `tours` slug check, satisfies **AC-9**, **AC-10**, **AC-11**, **AC-12** (end of the tracer thread: database to page to Viator)
5. Add the rating path: `GET /v1/experiences/:id/rating`, the web `/protected/tours/[experienceId]/rating.json` proxy, `public/protected/tour-rating.js` with its mounting client component, the `/protected/` rule in the open branch of `robots.ts`, and the View Source test, satisfies **AC-2**, **AC-3**, **AC-6**
6. Add the 404 page for the route (`not-found.tsx` under `tours/[experienceId]`) with a link to `/discover`, satisfies **AC-8**
7. Add the back link as a small client component reading `from` with `useSearchParams` inside `Suspense`, validated against the shared lists, satisfies **AC-13**, **AC-15**
8. Add the analytics: ids on `canvas_tile_click`, the `trackTourPageViewed` helper and its call, `source: "tour_page"` on the booking event, satisfies **AC-14**
9. Add the sitemap exclusion test, satisfies **AC-7**
10. Switch `tourHref` to the new page with its unit test, then click a tile in a production build, satisfies **AC-16**
11. Run the iPhone 16 check on a production build, satisfies **AC-17**

The page does not go live (task 10) until the canvas rating leak in Follow-up is fixed, because shipping a compliant page beside a non compliant canvas changes nothing for Viator's rule.

Until task 10 ships, `tourHref` keeps pointing at `/destinations/:citySlug`.

## Consequences

**Positive**:
- Every canvas tile gets a real page and a logged booking click, and the ledger row joins search popularity on `Tour.id`.
- The rating stays inside Viator's protected content rule from day one.
- No migration, no new secret, and ISR keeps api load near zero.
- The page is the natural home for the AI copy (BRI-154) and for indexing later.

**Negative / tradeoffs**:
- The rating appears a moment after the page, and not at all without JavaScript.
- Prices can be up to 15 minutes behind the database (and the database is refreshed nightly). The "final price on Viator" note covers this.
- A 404 is also cached for 15 minutes, so a newly linked Experience can 404 briefly.
- The page Tour (lowest id) can differ from the canvas tile Tour (best score) if an Experience ever gains a second Tour. Dev has none today.
- The `campaign` value is fixed at `canvas-tour`, so a later link from search or a city page would need its own value.
- The back link uses `?at=`, which does nothing until the canvas position URL (scope row 14) ships. Until then it opens the canvas at its default spot.

**Neutral**:
- A second click route (`/go/tours`) now sits beside `/go/[slug]/[id]`. Both log to the same ledger.
- `/protected/` is a new robots blocked path that later protected content can reuse.
- The `docs/06` line that calls the aggregate rating safe is now known to be stale.

## Follow-up

- [ ] **Blocks task 10.** The canvas JSON route (`/api/canvas/buckets/...`) ships `ratingAvg` and `ratingCount` on an unblocked path, and `CanvasItem` renders the rating on `lg` tiles. Under Viator's protected content rule this needs a fix in spec 0004 (move the rating behind `/protected/` or drop it from the tile) before `tourHref` switches.
- [ ] Fix the host check in `/go/[slug]/[id]/route.ts`: `endsWith("viator.com")` accepts `evilviator.com`.
- [ ] Update `docs/06-viator-api-integration-guide.md` line 63: the aggregate rating is protected content, per Viator's 2026-09-21 reply (BRI-204).
- [ ] Add a rate limit to the public api endpoints (shared with the canvas feed Follow-up).
- [ ] Check on production (read only) that no Experience has more than one live Tour.
- [ ] A separate ticket for the per page index flip: valid AI copy, the BRI-201 golden stamp, and the browser loaded rating all required; it also adds those pages to the sitemap.
- [ ] Decide whether `campaign` becomes source specific when another surface links to the page.
- [ ] Open design items for the designer (the build ships placeholder styling only): section order and layout; header and footer; how price, duration, and cancellation are presented; the rating placeholder and its loading state; the button style; the back link; the 404 page; the cover image crop and aspect ratio; the mobile layout.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
