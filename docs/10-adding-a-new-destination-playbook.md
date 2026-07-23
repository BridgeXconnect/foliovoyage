# 10 — Adding a New Destination (Playbook)

**Run from:** `/Users/roymkhabela/Folio_Voyage/frontend`
**Read alongside:** `docs/07-viator-integration-brief.md` (link wire-up) and `docs/08-brand-voice-style-guide.md` (voice).

This is the repeatable process for adding a destination to Folio Voyage — writing the guide, then attaching real Viator links. **It works today, on Basic Access, with no database and no Full Access.** Viator's `/products/search` is available at Basic tier, so research and matching need nothing we don't already have. The only step that requires anything new is the last one (a real `VIATOR_API_KEY` to run the enrichment script), and that's the same key the existing six destinations use.

There is no ingestion pipeline to feed and no backend to deploy (see TD-11 in `docs/02`). A destination is just data plus a one-time link-matching pass.

---

## Overview

Four steps, in order:

1. **Research** — call `/products/search` for the new destination to see what Viator actually sells there. This is input for your writing, **not** content to paste.
2. **Write** — add original guide + experience copy to `src/data/destinations.ts`, in the house voice (doc 08).
3. **Match** — run the enrichment script to attach real `affiliateUrl`s to the experiences that have a confident product match (doc 07).
4. **Publish** — build, review, ship.

---

## Step 1 — Research the destination (not content)

Find what Viator carries so your hand-written experiences map onto real, bookable products later. Two ways:

- **Quick look:** browse the destination on viator.com and note the strongest, most distinctive products (specific landmarks, food tours, day trips).
- **From the API:** temporarily add the new city to the parser's reach and print search results, or hit `/products/search` in Postman with the destination's ID. The `fetch-viator-links.mjs` script already resolves IDs and searches — you can read its console output as a research dump before you've written anything.

**Do not copy Viator's product titles or descriptions into the site.** That supplier copy appears on viator.com and other affiliate sites; reusing it creates duplicate content and breaks the site's "independently written" promise. Research tells you *what exists to link to*; you still write the cards yourself.

---

## Step 2 — Write the guide (house voice)

Add a new `Destination` object to the `destinations` array in `src/data/destinations.ts`. Copy the shape of an existing entry (`bangkok` is the most complete). You need:

- `slug`, `city`, `country`, `tagline`
- `heroImage` / `heroImageAlt` (add the image via the existing image-resolve scripts; credit it)
- `intro` — 2–3 original paragraphs
- `knownFor`, `bestTime`, `fromPrice`
- `neighbourhoods` — 3–4 "where to base yourself" notes
- `experiences` — ~8 `Experience` objects: `id`, `title`, original `description`, `image`/`imageAlt`, `category`, `priceBand`, optional `duration`. **Leave `affiliateUrl`/`provider` unset** — step 3 fills them in.

Write to `docs/08`. In particular:

- Claim **curation and judgment**, not manual keystrokes. "Researched and vetted", "checked", "hand-picked" — never "written by hand".
- **One em dash per paragraph, maximum.** Use a comma or full stop otherwise.
- No banned constructions: "it's not just X — it's Y", "whether you're X or Y", "come for X, stay for Y", stacked intensifiers ("truly", "genuinely", "unforgettable"), or generic travel clichés ("hidden gem", "bustling", "must-see").
- Prefer specific, checkable detail (a price, a street, an opening time, a dish) over abstract praise. Blunt opinions are welcome.

The new destination auto-appears in the nav, sliders, `/destinations`, sitemap, and its own `/destinations/<slug>` page — those all read from the same data via `src/data/destinations-helpers.ts`. No page code to touch.

Verify it renders:

```
npm run build        # SSG prerenders the new page; catches type/data errors
npm run dev          # eyeball the new /destinations/<slug>
```

At this point the experience cards show "Booking coming soon" — correct, until step 3.

---

## Step 3 — Match real Viator products & attach links

This is doc 07's process, and it already handles any number of destinations — the script reads every destination out of `destinations.ts`, so a new city is picked up automatically.

```
# frontend/.env.local  (gitignored)
VIATOR_API_KEY=your-real-key

node scripts/fetch-viator-links.mjs
```

The script:

- resolves the new city to a Viator destination ID (written to `src/data/viator-destinations.json`),
- fetches `/products/search` for it,
- fuzzy-matches each hand-written experience to the best real product,
- for confident matches, writes `{ affiliateUrl, provider }` to `src/data/viator-links.json`, keyed `"<slug>/<experienceId>"`, with the verbatim `productUrl` plus `&campaign=<slug>-card`,
- **leaves weak matches unset** (a wrong match is worse than none).

`destinations-helpers.ts` merges `viator-links.json` into the experiences at load time, so matched cards flip from "Booking coming soon" to a live `sponsored nofollow` link with no component change.

**Review the match report** the script prints. If a landmark matched the wrong product, remove that key from `viator-links.json` (or tune `MATCH_THRESHOLD` in the script). Original titles/descriptions are never modified — only links attach.

---

## Step 4 — Publish

```
npm run build        # confirm the new links render and nothing regressed
```

Review the new page and its links locally, then ship. Do not deploy without Roy's go-ahead.

---

## Why no Full Access or database is needed

- `/products/search` is a **Basic Access** endpoint, so both research (step 1) and matching (step 3) work today.
- Viator handles booking, tracking, and commission after the click-through — we host no checkout and store no product catalogue, so there is no database to feed.
- The only endpoint we'd want that Basic Access lacks is `/products/modified-since` (bulk catalogue delta ingestion). We don't use it: we match a fixed, hand-written set of experiences per city, not an auto-synced catalogue. Full Access becomes worth applying for when you want to scale *beyond* hand-picked destinations (true ingestion, reviews, availability) — see TD-11 in `docs/02`. Until then, this playbook is fully repeatable as-is.
