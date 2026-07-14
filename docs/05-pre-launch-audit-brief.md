# 05 — Pre-Launch Audit: Deploy & OTA Submission Readiness

**Run this from:** `/Users/roymkhabela/Folio_Voyage/frontend`
**App under test:** `http://localhost:3001` (confirm it's actually running before starting; if it's not, start it and note which command you used)

## Purpose

This is a QA audit, not a build task. Do not fix issues as you find them — **catalogue everything first, then present a single report**, so Roy can decide what to fix before submitting to Viator/GetYourGuide and deploying to Vercel.

There are **two separate bars** here — keep them distinct in the report, since a site can clear one without clearing the other:

1. **Deploy-ready** — technically sound: builds clean, no errors, reasonable performance, correct config.
2. **OTA-submission-ready** — content and compliance sound enough to survive a manual affiliate-program review: genuine substantive content, indexable, disclosure present.

Reference `docs/04-mvp-scaffold-brief.md` for the original scope/definition of done this build was targeting, and `docs/03-engineering-specification.md` (specifically **ST-30**'s content-quality acceptance criteria) for the exact content-quality bar to check against — read the actual criteria there rather than assuming numbers.

---

## A. Content readiness (OTA submission)

For the homepage, every destination page, and the blog/legal pages:

- [ ] No lorem ipsum, "TODO," or obviously placeholder copy remains anywhere.
- [ ] Each destination page meets the substantive-content bar defined in ST-30 (word count, unique summary, minimum experience count) — check against the actual criteria in the doc, don't guess.
- [ ] Each destination page has 6–12 Experience cards, each with a real (non-broken) image, title, description, and tag/category.
- [ ] CTA buttons on Experience cards are in a deliberate, honest "coming soon"/disabled state — not fake links that imply a working booking flow.
- [ ] No real, unreplaced Viator/GetYourGuide affiliate links are live yet (flag if any exist — since click-tracking (`/go/:tourId`) per FR-AFF-1 isn't built, a raw affiliate link right now would leak commission without attribution).
- [ ] Disclosure page is linked from every page that has a CTA (homepage, each destination page).

## B. Technical SEO

For each real page (homepage, each destination, blog, legal):

- [ ] Fetch the raw HTML (curl is fine, doesn't need a browser) and confirm: unique `<title>`, unique meta description, OG tags present, exactly one `<h1>`.
- [ ] **Critical:** confirm there is no `noindex`/`nofollow` meta robots tag on any real content page. (The old reference project had this set globally — this must not have carried over.)
- [ ] JSON-LD structured data (`TouristAttraction` or `ItemList`) present on destination pages.
- [ ] `/robots.txt` and `/sitemap.xml` render correctly, list the real routes, and don't disallow anything that should be indexed.
- [ ] `metadataBase` (or equivalent) is set for production so OG/canonical URLs resolve to absolute URLs, not `localhost`.

## C. Design parity

- [ ] Font pairing matches the reference project (Fraunces / Inter / Poppins) — check `layout.tsx`/font loading, not just visual impression.
- [ ] Color tokens/spacing broadly match `/Users/roymkhabela/Tour Curator Site/frontend`'s `src/styles/default_theme.css` and `globals.css` (side-by-side comparison, not pixel-exact).
- [ ] If you don't have a browser-rendering tool available, say so explicitly in the report rather than asserting visual parity you can't actually verify — flag this section as needing Roy's own visual pass if so.

## D. Build & deploy readiness

- [ ] Run the actual production build (`npm run build`) — **not just the dev server** — and report every error and warning. A clean dev server does not guarantee a clean production build.
- [ ] Run `npm run lint` and report issues.
- [ ] TypeScript check with no errors (via the build or `tsc --noEmit`).
- [ ] `.gitignore` correctly excludes `node_modules`, `.next`, `.env` — confirm nothing sensitive is staged or committed (`git status`, and check history if anything looks off).
- [ ] `.env.example` accounted for — no secrets hardcoded in source that should be env vars.
- [ ] Check `public/` for oversized, unoptimized images that would hurt build time or Core Web Vitals; confirm images use `next/image` where practical.
- [ ] No leftover dev-only routes, stray `console.log`s, or broken internal links (crawl the nav yourself).

## E. Report format

Structure the final output as:

```
✅ Ready
⚠️ Needs attention (non-blocking — can deploy/submit without fixing, but should fix soon)
❌ Blocker (must fix before deploy AND before OTA submission)
```

Under each, separate **Deploy-readiness** items from **OTA-submission-readiness** items, since they may not overlap. End with a short, explicitly prioritized fix list — the 3–5 things Roy should do first.
