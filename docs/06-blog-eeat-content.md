# 06 — Blog content & E-E-A-T (status + follow-ups)

**Status:** The Folio blog has been rewritten into researched, cited, structured
long-form content. The live content now lives in `apps/web/src/data/blog.ts`
(not in this doc). This file records what shipped and the remaining E-E-A-T
follow-ups that need a human decision.

## What shipped

- **Structured content model** — `Block[]` (`p` / `h2` / `list` / `pick`) plus a
  per-post `Source[]`, in `apps/web/src/data/blog.ts`, rendered by
  `apps/web/src/components/covilla/BlogBody.tsx`. Real `<h2>` structure, bullet
  lists, curated **pick** callouts that link to the destination guides, and a
  visible **Sources** list.
- **8 posts, all substantive** (~800–1,100 words of body each, up from ~200–300):
  - 3 new city guides — `best-things-to-do-in-{bangkok,kyoto,rome}` — planning
    guides that curate the destination experiences and cross-link to the
    canonical guides.
  - 5 deepened — `bangkok-first-24-hours`, `eat-where-the-locals-queue`,
    `shoulder-season-travel`, `one-neighbourhood-rule`,
    `how-we-choose-what-to-feature`.
- **Research + citations** — every time-sensitive fact (hours, fares, ticket
  rules, seasons) traces to a cited source; **all cited URLs verified to resolve
  (HTTP 200)**. Posts also tell readers to confirm specifics before travelling.
- **Schema** — `BlogPosting` JSON-LD with named `author`, `publisher`,
  `datePublished`/`dateModified`, and `citation` (source URLs).
- **Visible byline + "Last reviewed" date + author box** on every post.

## The honesty guardrail (kept)

Voice is editorial/curatorial ("we recommend / most travellers find") — the
publisher curating experiences. There are **no first-person "I went / we ate
there" claims**. That distinction is the rule: recommending a researched,
cited experience is fine; claiming a specific person did something they didn't
is not.

## Remaining E-E-A-T follow-ups (need a human decision)

1. **Real named byline.** Posts currently use an honest editorial identity,
   `FOLIO_AUTHOR` in `blog.ts` (`name: "Folio Voyage Editorial"`). A real named
   author (Roy, or a byline you'll stand behind) with a short truthful bio and an
   author/about page is the single biggest remaining Experience/Expertise lift.
   Swap `FOLIO_AUTHOR` and, ideally, add a `/about` (or author) page for
   `author.url` to point at instead of `/legal/contact`.
2. **First-hand specifics where you have them.** The Bangkok posts are structured
   to absorb genuine local detail (the specific stall, the exact pier, the timing
   trick). Add it in your own voice where it's true — it's the content a
   scraper can't produce.
3. **`Person` vs `Organization` author in schema.** If you adopt a personal
   byline, switch the JSON-LD `author` type from `Organization` to `Person` in
   `apps/web/src/app/blog/[slug]/page.tsx`.
4. **Publisher social profiles.** Add real `sameAs` social URLs to the publisher
   `Organization` schema once the accounts exist (the footer currently links to
   placeholder platform homepages).

## Notes

- Source URLs were verified at rewrite time (July 2026). Hours/fares/ticket rules
  change — re-verify before relying on any specific figure, and update the
  `lastReviewed` date when you do.
