# apps/web

## Overview

`@folio/web` — Next.js 15 App Router frontend for Folio Voyage (Atlas), "the
existing app" (moved from the old top-level `./frontend`). Renders the
`/destinations/:slug` editorial pages and serves the two content systems
described in root [AGENTS.md](../../AGENTS.md) "Two content systems in
transition".

## Commands

Run from the repo root.

```bash
doppler run -- pnpm --filter @folio/web dev

# Tests (jest, specs live next to source as *.spec.ts)
pnpm --filter @folio/web test
```

## Conventions

- Server components fetch destination data from the API via
  `src/lib/api.ts` (`fetchDestination`) — `API_BASE_URL` env var, no client-side
  fetching, no data hardcoded in components. A 404 from the API becomes `null`
  → Next.js not-found; any other failure throws, including a 200 whose body no
  longer matches the `@folio/shared` wire schema (BRI-214; see
  `packages/shared/AGENTS.md`).
- `src/app/destinations/[slug]/page.tsx` (and the rest of `src/data/`) read the
  static `destinations.ts` content system and are the **canonical** destination
  surface. `src/app/destinations/[slug]/[city]/page.tsx` is the DB-backed
  ST-11 ingest URL, kept only as a permanent alias that **308-redirects** to the
  canonical short URL (BRI-166) — it renders nothing itself. `src/lib/api.ts`
  (`fetchDestination`) and `DbExperienceCard` are the retained DB read layer a
  follow-up (BRI-168) will use to surface ingested price/image/`affiliateUrl` on
  the canonical editorial cards. See root [AGENTS.md](../../AGENTS.md) "Two
  content systems in transition" above.
- UI building blocks live in `src/components/`; a themed subset (marketing
  site look) lives under `src/components/covilla/`.
- Tailwind v4 (`@tailwindcss/postcss`), ESLint via `next/core-web-vitals` + `next/typescript`.

## Analytics — PostHog (client-side)

Product analytics runs **entirely client-side** in the web app (there is no
server-side analytics service yet). Initialised in
`apps/web/instrumentation-client.ts` (the Next.js 15.3+ pattern — do **not** add a
`PostHogProvider`), with ingestion reverse-proxied through `/ingest`
(`next.config.ts` rewrites) so ad-blockers don't drop events. Capture is
anonymous: `person_profiles: "identified_only"` and we never call `identify`; IP
anonymisation, ~50% session-replay sampling, and full input/text replay masking
are set project-side in PostHog (US region).

- **Events:** autocapture (`$pageview`, web vitals) + ~12 custom events. The
  revenue event is `experience_booking_clicked` — fire **all** affiliate-CTA
  captures through the shared `trackAffiliateClick()` helper in
  `src/lib/analytics.ts` (it carries `experience_id` + destination context), never
  an inline `posthog.capture`. Dormant affiliate cards (`DbExperienceCard`,
  `ExperienceCard`) should adopt the same helper when they regain booking links.
- **Env:** `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` (documented in
  `apps/web/.env.example`); set in Vercel. No host var — the proxy path and UI
  host are hardcoded. Nothing sends until the token is set + a fresh build ships.
- **Scope boundary:** this **partially** satisfies FR-ANALYTICS-1 (page views +
  affiliate clicks today; search/filter/pin events land as those features do). It
  is client-side behavioural capture only and is **complementary to** — not a
  replacement for — the server-side click ledger (FR-AFF-1), which has since
  shipped: `apps/web`'s `/go/:slug/:id` route (`src/app/go/[slug]/[id]/route.ts`)
  logs each click by POSTing to the API's `POST /v1/affiliate-clicks`
  (`AffiliateClick` model) before 302-ing to the verbatim `productUrl` (BRI-136).
  Don't treat PostHog as covering the ledger, or vice versa.
