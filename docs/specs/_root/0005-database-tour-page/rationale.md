# 0005. Database tour page: rationale

The decision record for [index.md](index.md). The build does not read this file.

## Context

The discovery canvas (spec 0004) shows tours that come from the database ingest pipeline. When a visitor clicks a tile, `tourHref` sends them to the city page, because the only tour detail page (`/destinations/[slug]/experiences/[experienceId]`) and the only click redirect (`/go/[slug]/[id]`) are built from hand authored static content. A database tour has no page, no booking button, and no logged click. The canvas is meant to be the main top of funnel surface, so a click that lands on a generic city page loses the visitor's intent and the affiliate revenue it should produce.

Viator's rules shape what such a page can show. Its 2026-09-21 reply on BRI-204 says AI written copy is allowed when grounded in standard product fields, that pricing, availability, and cancellation must stay live and strictly unmodified, and that the `reviews` element (rating average and count included) is protected content. Protected content must never appear in page source (server HTML or inline script) and must load through an external script that is itself blocked in `robots.txt`. A `noindex` tag alone does not satisfy the rule. The older `docs/06` note calling the aggregate rating safe predates this answer.

The data is ready but thin. On dev, 845 of 846 Experiences are published, every live linked Tour has a Viator affiliate link and a cancellation policy, and only one Tour has published AI copy. The schema allows several Tours per Experience, though the linker keeps it one to one today. The AI copy read (`resolveAiSummary`) and the destination read both pick the live Tour with the lowest id. The click ledger (`AffiliateClick`) is written only by the web app's server, with a shared secret, and search popularity already joins it on `Tour.id`.

Two web conventions matter. Database pages so far render on every request (`force-dynamic`, `no-store`), and the site gate in `middleware.ts` rewrites every path to `/coming-soon` without the preview cookie. Without a decision, the canvas either keeps linking to city pages or a page gets built that puts the rating into its HTML and puts the affiliate account at risk.

## Options considered

### Option 1: ISR page, two endpoints, rating by a blocked script, dedicated click route

A page at `/tours/:experienceId`, cached for 15 minutes, reads one api endpoint for everything except the rating. A small static script under `/protected/` fetches the rating from a second endpoint through a robots blocked proxy. The button goes to `/go/tours/:experienceId`, which logs the click and redirects.

**Pros**:
- Meets Viator's protected content rule exactly, with a test that proves the HTML has no rating.
- Every click is logged on the server, which ad blockers cannot stop.
- ISR means almost no api traffic, and no migration or new secret.

**Cons**:
- Two endpoints and a hand written script are more pieces than a single page.
- The rating appears late and needs JavaScript.
- The 15 minute cache also applies to 404s and prices.

### Option 2: Dynamic page with everything server rendered, rating left out

Render on every request like the existing database pages, and drop the rating entirely to stay within Viator's rule.

**Pros**:
- Simplest: one endpoint, no script, follows the current `force-dynamic` pattern.
- Always fresh data.

**Cons**:
- Loses the rating, which is a strong decision signal for a visitor.
- Every view hits the api and the database, with no rate limit on the api today.

### Option 3: Extend the static detail page to read database tours

Reuse `/destinations/[slug]/experiences/[experienceId]` and its `/go/[slug]/[id]` route, switching them to read from the api when the id is a database id.

**Pros**:
- One detail page and one click route for both content systems.
- Reuses the existing layout and JSON-LD.

**Cons**:
- The static page is built with `generateStaticParams` and `dynamicParams = false`. Mixing in database ids means rewriting how it renders and risking the pages that serve traffic today.
- It renders the rating server side and is indexed, which would break Viator's rule for database tours.
- It conflates the two content systems that AGENTS.md says to keep apart during the migration.

### Option 4: Link the tile straight to Viator

Skip the page. The tile opens the affiliate link in a new tab and PostHog logs the click.

**Pros**:
- Nothing to build beyond `tourHref`.
- Fastest path to the booking.

**Cons**:
- No server ledger row, so revenue attribution depends on a client event that blockers drop.
- No home for the AI copy, and nothing to index later.
- The visitor leaves the site from the canvas with no chance to compare.

## Rationale

Option 1 is the only one that respects Viator's protected content rule while keeping the rating, and the rating is the signal most likely to move a visitor to click. The rule is precise about the mechanism (external script, blocked in robots), so the spec copies the mechanism rather than an approximation, and a View Source test pins it. Option 2 is a fair fallback if the script ever proves unreliable, and moving to it is a deletion, not a rewrite.

Caching with ISR goes against the existing `force-dynamic` database pages, on purpose. Those pages predate any measured traffic, and this one will receive every canvas click. Viator's live data rule is about not altering values, not about real time reads: the database itself refreshes nightly, so a 15 minute cache adds no meaningful staleness, and the page says the final price is on Viator. The cost of ISR is that the page cannot read the query string on the server, which is why the back link reads `from` in the browser.

The page keys on the Experience id because that is what the canvas tile already carries, and it picks the lowest id live Tour because that is the rule the AI copy read uses. Picking the canvas feed's best scoring Tour would let the page show AI copy written for a different Tour. Option 3 was rejected because it would destabilise the static pages that serve traffic today and mix the two content systems mid migration. Option 4 gives up the server ledger, which is the one count of affiliate clicks that does not depend on the browser.

The click route races the ledger POST against a 1.5 second timer. If the timer wins it redirects and lets the same POST finish in the background with `after()`. Fire and forget would lose rows when a serverless function freezes after the response, an unbounded wait would let a slow api delay every booking, and aborting at 1.5 seconds would drop the row on a cold start (BRI-237). The cost is that FR-AFF-1 is now best effort after 1.5 seconds, recorded as a deliberate trade off.

## Interview record

Decided by Roy in the interview, each as recommended: route `/tours/:experienceId`; `noindex` until AI copy plus the stamp; rating loaded in the browser from a robots blocked route by a tiny standalone script; fields duration, verbatim cancellation, and provider description as plain text, with no gallery and no inclusions or exclusions; AI copy replaces the description; own redirect `/go/tours/:experienceId`; the existing Viator fallback (destination page, else account root); `?from=` back link; ids on the tile click, a new page view event, and the booking event reused; ISR at 15 minutes; supplier price and currency as returned; a 404 page with a way back; two endpoints; click log raced against a 1.5 second timer; no data model change.

Decided here without a separate question (for you to accept or change): the largest available image variant with a plain `<img>`; the alt text order (`imageAlt`, then title); `campaign=canvas-tour` set by string handling, not `searchParams.set`; serving the rating script as a static file in `apps/web/public/protected/` instead of a route handler (no build step, nothing to cache wrongly); reading `from` in the browser so the page stays ISR; `not-found.tsx` scoped to the route, since the app has no global one.

Applied after the cross check (another model, read only): the rating script mounts from a client component so client side navigation also fills it; the fallback is named for what `buildProviderFallbackUrl` really returns; `campaign` is replaced or appended; api errors throw instead of caching a 404; a cuid check guards every path id; image dimensions are nullable and images are plain `<img>` elements; the description stripper is defined; `from` must name the tour's own city; the rating proxy carries cache and noindex headers; the canvas `robots.txt` rule now gates the `tourHref` switch.

Corrected in the final fixes: the 1024 px image minimum cannot be met (Viator's largest variant is about 720 px) and `next/image` was dropped; `searchParams.set` was replaced by string handling so the rest of the URL stays byte for byte; and the canvas "leak" was reframed, since the canvas HTML carries no rating but its loading chunk is not robots blocked.
