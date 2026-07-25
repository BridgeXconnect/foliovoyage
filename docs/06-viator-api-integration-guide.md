# 06 — Viator Partner API: Integration Guide (Basic Access)

**Source docs reviewed:** `docs.viator.com/partner-api/technical/` (full technical reference) and the implementation guides at `partnerresources.viator.com` (Golden Path for Basic Access, Affiliate Attribution, Front-End Guide).

## The one thing that changes the plan: you're on Basic Access, and that means no catalog ingestion yet

Viator affiliates have four access tiers: **Basic Access → Full Access → Full Access + Booking → Merchant**. Fresh approval puts you at Basic Access by default (confirm this in your partner dashboard, but this is the standard starting tier).

Basic Access gives you:

| Endpoint | Access | Use |
|---|---|---|
| `/products/search` | ✅ | Product summaries by destination/filter — your main workhorse |
| `/products/{product-code}` | ✅ | Full detail for one product, on demand |
| `/products/tags` | ✅ | Category/tag taxonomy |
| `/attractions/search`, `/attractions/{id}` | ✅ | Attraction data |
| `/availability/schedules/{product-code}` | ✅ | Pricing/schedule for one product at a time |
| `/destinations` / `/v1/taxonomy/destinations` | ✅ | Destination hierarchy (country → region → city) |
| `/search/freetext`, `/locations/bulk`, `/exchange-rates` | ✅ | Supporting lookups |

But **not** available at Basic Access:

| Endpoint | Why it matters |
|---|---|
| `/products/modified-since` | This is the bulk/delta catalog ingestion endpoint — the thing a nightly "import pipeline into Postgres" architecture depends on. **Not available until Full Access.** |
| `/products/bulk` | Also gated to Full Access+ |
| `/availability/check`, `/availability/schedules/bulk`, `/availability/schedules/modified-since` | Real-time/bulk availability checking — Full Access+ |
| `/reviews/product` | Review content — Full Access+ |
| All `/bookings/*` endpoints | Irrelevant to you anyway — see below |

**Practical consequence:** the Architecture Spec's nightly-ingest-into-Postgres pipeline (FR-IMPORT-1/2) can't be built yet. Right now, the right architecture is **fetch-on-demand with caching** — call `/products/search` per destination and cache the response (Next.js ISR/revalidate on a several-hour interval is a natural fit), rather than standing up a database-backed ingestion job. That's not a workaround, it's just what the current access tier supports well. Revisit the Postgres pipeline when you apply for Full Access.

## You don't need to build booking or a redirect-tracking system — Viator already does it

This is genuinely simpler than the original plan assumed. As a Basic Access **affiliate** (not merchant), you never process a booking on your own site. The flow is:

1. Show product content on your site (from `/products/search` / `/products/{code}`).
2. User clicks through to **the exact `productUrl` the API already returns** — e.g. `https://www.viator.com/tours/.../d4371-227717P1?mcid=42383&pid=P00063937&medium=api&api_version=2.0`. This URL already has your account's `pid` and `mcid` baked in.
3. Landing on viator.com sets a cookie. **Any purchase within 30 days is attributed to your account automatically.** Viator tracks and pays the commission — you don't build any of this.

**The only rule: never strip, reorder, or reconstruct those URL parameters.** Use the `productUrl` field verbatim. The one thing you're free to add is your own `&campaign=your-value` on the end, for your own analytics (e.g. `campaign=bangkok-page` vs `campaign=blog-post`, so you can see which content drives clicks in your own dashboard) — alphanumeric and dashes only, no other special characters, or tracking can break.

This means **FR-AFF-1's planned `/go/:tourId` server-side redirect-and-log system is now optional infrastructure for your own analytics, not something Viator requires.** If you want click analytics on your end, build a thin internal redirect that logs the click and then 302s straight to the untouched `productUrl` — but it's a nice-to-have, not a blocker.

## A real compliance constraint worth knowing now, even if it doesn't bite yet

Viator requires that **reviews and anything in the `viatorUniqueContent` object never appear in page source** — not in HTML, not inline in `<script>` tags. It must be loaded via an *external* JS file that is itself blocked in `robots.txt`, so search engines can't index Viator's proprietary content.

You don't have review access at Basic tier, so this doesn't bite yet. But it's worth flagging now: when you move to Full Access and start pulling reviews, this sits in real tension with an SSR-everything approach to SEO. The pattern to use later: reviews get fetched client-side from a separate, robots-disallowed endpoint, while everything else on the page stays server-rendered for indexing. Good to know before you build it, not after.

## Front-end shape (recommended, not mandatory)

Viator's own guide, based on evaluating "hundreds of affiliate sites," recommends: **Landing page → Search Results Page (SRP) → Product Display Page (PDP)**. Encouragingly, this already matches your sitemap almost exactly (destinations → experience list → detail), so this is a data-source swap on your existing pages, not a redesign.

- **SRP** (your destination pages): rating, thumbnail, teaser, free-cancellation flag, price, category filters via tags, destination breadcrumb.
- **PDP** (a real product detail, if you build one — currently your "experience cards" link back to the destination page, which is a valid simpler pattern too): title, rating, 3-level breadcrumb (country/region/city), photos, "price from," cancellation policy, duration, languages, overview, inclusions/exclusions, itinerary, nearby attractions.

**Correction (verified live, 2026-07-16):** the `/products/search` summary **does** return
useful commerce fields at Basic tier — confirmed by dumping a real product: `pricing.summary.fromPrice`,
an **aggregate `reviews` object** (`combinedAverageRating` + `totalReviews`, sourced from Viator +
TripAdvisor), `flags` (e.g. `FREE_CANCELLATION`, `PRIVATE_TOUR`), `duration`, `images`, and
`description`. What is Full-Access-gated is the dedicated **`/reviews/product`** endpoint (review
*content* / individual reviews), not the aggregate rating in the search summary.

**Critical correction — price is endpoint-specific (verified live, 2026-07-25, BRI-165):** the
`pricing.summary.fromPrice` shape above is real **only for the `POST /products/search` _summary_**.
The Full-Access **product _detail_** shape (`GET /products/{code}` and the `/products/modified-since`
crawl the ingest pipeline consumes) does **not** carry a price at all — a real detail payload has
`pricingInfo` = `{ type, ageBands }` (booking constraints only, no amount), and a deep scan of a full
product turns up no price/amount field anywhere. The "from" price for a detail-ingested product lives
in a **separate per-product endpoint**, `GET /availability/schedules/{code}` →
`{ "currency": "USD", "summary": { "fromPrice": 28 } }`. The ingest normalizer therefore leaves
price null and a dedicated price resolver (ST-7c) attaches it from `/availability/schedules`, exactly
as the location resolver attaches coordinates. Do not assume the search-summary price path holds for
detail payloads — it doesn't, and assuming it did quarantined 100% of real imports.

So `fromPrice`, star rating, and a free-cancellation badge are all **safe to surface now** — they
carry no duplicate-content risk (unlike Viator's supplier `title`/`description`/`images`, which we
deliberately do not show; see [docs/07](07-viator-integration-brief.md)). We currently persist only
`productUrl` (+ `productCode`/`title` for matching); surfacing price/rating/free-cancellation is a
small, high-signal credibility upgrade short of Full Access.

## Concrete next steps, in order

1. **Get your API key**: partner dashboard → Tools → Affiliate API → Start your development.
2. **Test in Postman** using Viator's provided collection before writing integration code.
3. **Resolve your 6 destinations to Viator's destination IDs** — call `/destinations` (or `/v1/taxonomy/destinations`, referenced in the Golden Path guide; check both, there may be a version discrepancy between the v1 and v2 docs) once, and build a lookup: Bangkok → id, Kyoto → id, Hanoi → id, Bali → id, Lisbon → id, Rome → id. This is the first real API call to make.
4. **Replace the 8 placeholder experience cards per city** with real product summaries from `/products/search` filtered by destination ID — same visual card, real data.
5. **Swap "Booking soon" for the real `productUrl`** (plus your own `&campaign=` value) as the CTA link.
6. **Cache responses** (Next.js ISR, revalidate every few hours) rather than building a database pipeline — appropriate for Basic Access; revisit when Full Access is granted.
7. When ready to scale beyond hand-picked destinations, apply for **Full Access** — unlocks `/products/modified-since` (true catalog ingestion), `/availability/check`, `/reviews/product`, and `/products/recommendations`. Worth applying once the Basic integration is live and generating some traffic/data to strengthen the case — it's a separate approval, not automatic.
