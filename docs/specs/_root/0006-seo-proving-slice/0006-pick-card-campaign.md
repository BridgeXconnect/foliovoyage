# 0006. Rating free pick card and campaign tagged click out (child of 0006 SEO proving slice)

Scope row 22. Governed by [index.md](index.md): the campaign format, live set and representative tour rule live there.

## Summary

Each pick is a card with the Viator cover image, the provider's title, a duration label and the first three inclusions, and one "See on Viator" link to `/go/tours/{experienceId}?p={slug}`. The `/go` route checks `p` against the live slice pages. A match tags both the Viator link and a new `AffiliateClick.campaign` column with `seo-bangkok-{slug}`; anything else falls back to today's `canvas-tour`, so a click never breaks. One additive migration lands the column.

## Requirements

**User stories**:
- As a searcher, I want each card to tell me what the tour is and what it includes, so that I can pick one without a price war.
- As Roy, I want the click ledger to say which slice page sent a click, so that the week 12 readout can compare pages.

**Acceptance criteria**:
- **AC-C1**: A card shows the pick's image (`imageUrl`, alt `imageAlt`), its `title` verbatim, its band label (`Under 4 hours`, `4 to 8 hours`, `A full day`, `Duration not listed`), and up to 3 inclusions verbatim from the snapshot. It shows no price, availability, cancellation, rating or review data.
- **AC-C2**: The card's only link is `/go/tours/{experienceId}?p={slug}` with `rel="sponsored nofollow"`, `target="_blank"`, and the text `See on Viator`. No card links to `/tours/` or an experience page.
- **AC-C3**: In `apps/web/src/lib/tour-go.ts`, the campaign is `seo-bangkok-{p}` when the `p` query value is in `LIVE_SLUGS` (exact match, imported from `live.generated.ts`, so the route never bundles the page data), else `canvas-tour`. When `p` is present but not live, the route logs one line, `[go/tours] event=tour_campaign_fallback experience_id={id} p={first 64 chars of p, URL encoded}`, and still redirects.
- **AC-C4**: On the Viator branch, the redirect target is `withCampaign(page.affiliateUrl, campaign)`. On the fallback branch, the target is unchanged from today.
- **AC-C5**: The click POST body gains `campaign` on both branches. `POST /v1/affiliate-clicks` accepts an optional `campaign` (string, at most 64 characters, matching `^[a-z0-9-]+$`), stores it in `AffiliateClick.campaign`, and returns 400 problem+json when it is present and invalid. A missing `campaign` stores null, so existing callers keep working.
- **AC-C6**: One migration adds `campaign TEXT NULL` to `AffiliateClick` and an index on `(campaign, createdAt)`. It is additive only, and the release check confirms the pre deploy log shows "Applying migration" for it; the manual `doppler run --config prd -- pnpm --filter @folio/api migrate:deploy` step stays in the release prompt (AGENTS.md, BRI-197).
- **AC-C7**: Clicking a card fires the existing `trackAffiliateClick` with `experienceId`, `title`, `provider: "viator"`, `city: "Bangkok"`, `destinationSlug: "bangkok"`, and `source: "seo-bangkok-{slug}"`, and no price band, rating or cancellation fields.

## Decision

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Ledger field | New nullable `AffiliateClick.campaign` | `referrer` is stripped by many browsers and is not a record; `sessionId` means a visitor session; `providerId` means the provider branch | Parse `referrer` |
| How the page is passed | `?p={slug}` on the `/go` link, checked against `LIVE_SLUGS` | Cannot become an open tagging route: only known values are written | A signed token |
| Unknown value | Fall back to `canvas-tour` and log | A click must never fail for a tagging reason | Return 400 |
| Link attributes | `rel="sponsored nofollow"`, new tab | Google's guidance for paid links | `rel="sponsored"` only |

## Feature design

**Data model sketch**: `AffiliateClick.campaign String?` (new, nullable), `@@index([campaign, createdAt])`. All other columns unchanged.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/v1/affiliate-clicks` | POST | existing body plus `campaign`:string (optional) | 201 as today | `x-internal-secret` | 400 invalid campaign |
| `/go/tours/:experienceId` | GET | `p`:string (optional query) | 302 to Viator | public | 404 unknown tour (unchanged) |

**Value sourcing**:
| Action | Value | Source |
|---|---|---|
| Card | image, title, band, inclusions | snapshot pick |
| Card | link slug | the current page's slug |
| `/go` | campaign | `p` checked against `LIVE_SLUGS`, else `canvas-tour` |
| Ledger | `campaign` | the POST body |

**Security model**: the click endpoint stays behind `x-internal-secret`. The API validates the campaign format itself, so a direct caller cannot write arbitrary text. Anyone can add `?p=` to a `/go` link, and bots follow these links, so a live campaign's count includes some clicks that did not come from the page. That is accepted; `seo:clicks` splits out bot user agents (AC-R4).

**Critical test scenarios**:
- `?p=floating-markets` gives a Viator URL with `seo-bangkok-floating-markets` and a POST with that campaign, verifies **AC-C3**, **AC-C4**, **AC-C5**.
- `?p=evil` and a held slug fall back to `canvas-tour` and log, verifies **AC-C3**.
- A POST with `campaign: "Bad Value!"` returns 400, verifies **AC-C5**.
- The card's HTML passes the leak scan and has the agreed `rel`, verifies **AC-C1**, **AC-C2**.

## Build plan

1. Migration and Prisma schema change, satisfies **AC-C6**.
2. Controller and service accept and store `campaign`, with tests, satisfies **AC-C5**.
3. `tour-go.ts` reads `p`, picks the campaign, logs the fallback, with tests, satisfies **AC-C3**, **AC-C4**.
4. `PickCard` and its click event, satisfies **AC-C1**, **AC-C2**, **AC-C7**.

## Rationale (short)

The ledger is the durable record (the PostHog event is behavioural and can be blocked), so the campaign belongs in a column. Checking `p` against the live set keeps the column's values to a closed list without a second registry.
