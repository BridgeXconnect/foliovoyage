# 0006. Page template and URL (child of 0006 SEO proving slice)

Scope row 21. Governed by [index.md](index.md): the live set, generated files, copy and notes schemas live there. Amended 16 Oct 2026 after the content research (D1, D3, D4, D6 to D9).

## Summary

One static route, `apps/web/src/app/destinations/bangkok/[page]/page.tsx`, renders every live slice page from its committed files. It is proven first on the hub (`things-to-do`). Every category page uses one template: the H1, a rule line with "Checked by the Folio team on {date}", the intro, a stat strip, "How to choose" sections with their picks, "Local notes" where a notes file exists, "Good to know", then the "How this page was made" note, the computed on date and the affiliate disclosure. The hub is a category index on the same template. Structured data carries names and positions only, and a leak scan checks the HTML (text, attribute values and JSON-LD) for any rating, price, availability or cancellation term, any personal name, and any wording that implies a bigger team. A local only preview renders pages that are not live yet, so Roy can read them before approving.

## Requirements

**User stories**:
- As a searcher, I want to see why these tours were picked and when the data was checked, so that I can trust the list.
- As a searcher, I want the tours split by the choice I'm actually making (which market, dinner or not), so that I can compare like with like.
- As Roy, I want the page to link only to places a visitor can reach while gated, so that nobody lands on the coming soon page from a slice page.

**Acceptance criteria**:
- **AC-T1**: The route prerenders one page per slug in `LIVE_SLUGS` (`generateStaticParams`) with `dynamicParams = false`, so any other `/destinations/bangkok/{x}` returns 404. The build output marks these pages static (prerendered), not dynamic. The only exception is the local preview (AC-T15), which never runs in a production build.
- **AC-T2**: `/destinations/bangkok` is still served by `apps/web/src/app/destinations/[slug]/page.tsx`, `/destinations/bangkok/experiences/{experienceId}` is still served by `[slug]/experiences/[experienceId]/page.tsx`, and `/destinations/thailand/bangkok` still 308 redirects to `/destinations/bangkok`. None of those three files is edited. A route test requests all three after the new folder exists.
- **AC-T3**: Block order (D1). A block with nothing to show is omitted, never padded.
  - **Category page**: the H1 from the manifest; the rule line and the checked line (AC-T12); the intro from the copy file; the stat strip (AC-T13); "How to choose", with one sub heading per section (the section's `label`) followed by that section's picks as cards, or, when the page shows one list, the picks with no sub headings; "Local notes" (AC-T14); "Good to know" (AC-T14); the "How this page was made" note (AC-T4); `Computed on {d MMMM yyyy}` from the snapshot; and the disclosure (AC-T11).
  - **Hub** (a category index): the H1; the rule line and the checked line; the intro; the stat strip over the union (AC-S4); then one section per category page it lists, in manifest order, each with the page's H1 as a link, a one line fact, and that page's 2 hub picks (`fromSlug`); then "Good to know", the note, the date and the disclosure. The hub has no "How to choose" heading and no Local notes. The one line fact is a template: `{memberCount} tours match its rule, most of them {length phrase}`, where the phrase is `under 4 hours`, `4 to 8 hours` or `a full day` from `mainLength`; when `mainLength` is null it is `{memberCount} tours match its rule`. Both values come from the hub snapshot's `facts.pages` (printable counts, index.md AC-9). Under the sections, the hub shows the counts caption (AC-T13). Since the hub is live only when every page it lists is ready (index.md AC-2), and a ready page it lists is then live too, it hides nothing at render.
  - **Stats page**: AC-D2, under the H1 and the checked line.
- **AC-T4**: The "How this page was made" note is a fixed template filled from manifest and snapshot data, with no generated text and no numbers (D6). On a category page it reads, with `{tags}` the page's tag names from `tagNames` joined with "or" in manifest order, `{sections}` the snapshot's section labels joined with commas and "and", and `{keywords}` the labels of the page's keyword groups joined the same way:

  > This page lists tours from Viator's Bangkok catalogue that carry the Viator tag {tags}, or whose titles mention {rule.plainWords}. It leaves out {exclusions.plainWords}. A minimum quality bar set from Viator's own traveller feedback decides whether a tour appears here, never where. Tours are grouped by {sections}. Inside each group they alternate across trip lengths, then follow how many of these they include: {keywords}, then Viator's product code.

  When the page shows one list, the last two sentences become "Tours alternate across trip lengths, then follow how many of these they include: {keywords}, then Viator's product code." Every category page note then ends, unconditionally: "Tours whose photos do not show the tour may be left out." (It depends on no data, since the snapshot does not say which members are on `excludedExperiences`.) On the hub, the first sentence is "This page takes two tours from each of the Bangkok topic pages linked above, each chosen by that page's own rule.", followed by the exclusions sentence and the quality bar sentence. A test renders the note for every page and asserts it holds no digit (the manifest strings it prints hold none, index.md), and runs the leak scan over it.
- **AC-T5**: Metadata: `title` = copy `seoTitle`; `description` = copy `metaDescription`; canonical `{site.url}/destinations/bangkok/{slug}`; `robots: { index: true, follow: true }`; Open Graph title, description and image. The image is the `imageUrl` of the pick whose `experienceId` is the page's `ogImageExperienceId` (D9); on the stats page, that pick is looked up in the category page snapshots. Every live page has one, because `hub-copy:approve` refuses without it (AC-H6).
- **AC-T6**: The leak scan, `pnpm --filter @folio/web seo:leak-scan`, runs after `next build` over `.next/server/app/destinations/bangkok/*.html`. For each file it takes three surfaces and fails on any match, case insensitive:
  - the visible text (the HTML with every `<script>` and `<style>` element removed, then tags stripped and entities decoded; the `<title>` text is included);
  - attribute values, entities decoded: the `content` of every `<meta>` element (description, `og:*`, `twitter:*`), and every `alt`, `aria-label` and `title` attribute;
  - the contents of each `<script type="application/ld+json">`.

  It skips the other scripts on purpose, because the framework's page data holds tokens like `$1a` that would trip the currency rule. It also fails when the set of files does not equal `LIVE_SLUGS`, which proves every live page prerendered. CI gains a step in the `lint-typecheck-test` job: `SEO_SLICE_PREVIEW=1 pnpm --filter @folio/web build && pnpm --filter @folio/web seo:leak-scan` (the variable is set on purpose, to prove a production build ignores it, AC-T15).
  - **Leak terms.** Matched at the start of a word: `rating`, `rated`, `review`, `price`, `availab`, `cancel`, `refund`. Whole words or phrases: `stars`, `sold out`, `book now`, `spots left`, `from` followed by a currency. Symbols: `★`, and any currency symbol or ISO code next to a digit (`$`, `€`, `£`, `฿`, `USD`, `THB`, `EUR`, `GBP`). There is no exemption for fees (D7): Good to know and notes describe fees in words, never as amounts. The list is one exported constant, `SEO_SLICE_LEAK_TERMS`, in `packages/shared/src/seo-slice.ts` (types and data only, so apps/api copies it into its own constants file and a parity test in apps/api reads the shared source file as text and compares). The snapshot (AC-S5, AC-M3), copy checks (AC-H3), notes and source facts (index.md) use the same list, applied to plain strings.
  - **Name and team terms (index.md AC-7).** The same scan, on all three surfaces, fails on the word `Atlas`, on any value of `factCheck.by` found in the copy files (as a whole word), on every entry of the manifest's `forbiddenNames` (whole word or phrase), on the phrases in `SEO_SLICE_TEAM_TERMS` (same file): `our editors`, `our experts`, `our writers`, `our team of`, `our staff`, and on the preview banner text "Not approved" (AC-T15). A failure that comes from a Viator title or image alt text is fixed by adding that Experience to `excludedExperiences` with its reason, never by editing the data.
- **AC-T7**: JSON-LD holds two objects: `BreadcrumbList` and `ItemList`. `ItemList.itemListElement` is `ListItem { position, name }` per pick in render order, with no `url`, `item`, `offers`, `aggregateRating` or `review`. No object has an `author`, and no `Person` appears anywhere.
- **AC-T8**: Breadcrumbs: on a category page and on the stats page, hub then the page (the hub's `h1`, `Things to do in Bangkok`, › the page's `h1`); on the hub, a single crumb. When the build time flag `SEO_SLICE_SITE_LINKS=1`, both start with `Home` › `Bangkok` (`/`, `/destinations/bangkok`). The visible breadcrumb and `BreadcrumbList` always match.
- **AC-T9**: With `SEO_SLICE_SITE_LINKS` unset, every internal `href` in a slice page's HTML is a live slice path or starts with `/go/tours/`. The page uses its own slice layout with no site header or footer links (no link to `/legal/disclosure`, which stays gated); the disclosure is shown in full inline. External links appear only in Good to know (AC-T14).
- **AC-T10**: Images use `next/image` with the pick's `imageUrl` (hosts are `media-cdn.tripadvisor.com` and `dynamic-media-cdn.tripadvisor.com`, already covered by `**.tripadvisor.com` in `remotePatterns`) and `imageAlt`.
- **AC-T11**: The disclosure (`SliceDisclosure`) is this fixed text, shown in full on every slice page: "Folio Voyage earns a commission when you book a tour through the Viator links on this page, at no extra cost to you. Tours appear by the rule on this page, never by commission."
- **AC-T12**: The rule line (D6) is a fixed template with no numbers. On a category page: "Tours from Viator's Bangkok catalogue tagged {tags}, or with {rule.plainWords} in the title. A minimum quality bar set from Viator's own traveller feedback decides whether a tour appears here, never where." On the hub: "Tours from each Bangkok topic page below, each chosen by that page's own rule. A minimum quality bar set from Viator's own traveller feedback decides whether a tour appears here, never where." Under it, on every slice page (stats included), the checked line: "Checked by the Folio team on {d MMMM yyyy}", from `factCheck.at` in `Asia/Bangkok`. A page without a matching `factCheck` is not live, so the line is always true when shown (in the local preview it reads "Not checked yet" instead, AC-T15).
- **AC-T13**: The stat strip renders each `strip` entry (AC-S4) in order with a fixed template: a keyword entry with a count above 0 as "{count} of {of} include {label}"; a length entry above 0 as "{count} of {of} take {label}"; a keyword entry of 0 as "None of the {of} include {label}"; a length entry of 0 as "None of the {of} take {label}". An empty `strip` renders nothing. Every number is a `facts` value, so every count is over printable members (index.md AC-9). Directly under a strip, and under the hub's sections, a fixed caption with no numbers: "Counts cover every tour in Viator's Bangkok catalogue that matches the rule, including tours below the quality bar." No page reads the snapshot's `eligible` block, which `pages.generated.ts` does not carry.
- **AC-T14**: "Local notes" renders each note from `{slug}.notes.json` (index.md) in file order: its `text` exactly as written (HTML escaped, no other change), then the line "Folio team, {written as d MMMM yyyy}". No other signature, name or byline is shown. "Good to know" renders each `sourceFacts` entry in manifest order: its `fact`, a link to its `url` with the link text being the url's host name, `rel="noopener noreferrer"` and `target="_blank"`, and "checked {d MMMM yyyy}" from `checked` (D4). Either block is omitted when it has no entries.
- **AC-T15**: The local preview, for the fact check read (AC-H13). `pnpm --filter @folio/web seo:preview` runs `SEO_SLICE_PREVIEW=1 next dev -p 3000` in apps/web directly: no Turbo and no Doppler.
  - **What it renders.** When the preview is on, `generateStaticParams` returns every manifest page that is not held and has a snapshot and a copy file in `pages.generated.ts`, live or not, instead of `LIVE_SLUGS`. Each page renders exactly as it would live, with two differences: a banner at the top of the page, "Not approved: local preview only", followed by the AC-2 reasons the page is not live (no `factCheck`, `checkHash` stale, or the hub not live), shown on every preview page, live ones included; and, when the page has no matching `factCheck`, the checked line reads "Not checked yet" instead of a date. A stale `factsHash` or `groundingHash` shows the same error the build gives, so you regenerate before you read.
  - **Where it can run.** The preview is on only when `isSlicePreview(env)` in `apps/web/src/lib/seo-slice/preview.ts` returns true: `SEO_SLICE_PREVIEW` is `1`, `NODE_ENV` is `development`, and `VERCEL` is unset. `next build` sets `NODE_ENV` to `production`, so a production build, local or on Vercel, never takes the preview path even with the variable set.
  - **Tests.** A unit test of `isSlicePreview`: true only for the development case above; false with `NODE_ENV=production`, with `VERCEL=1`, and with the variable unset. And the CI build step (AC-T6) runs `next build` with `SEO_SLICE_PREVIEW=1` set, so the leak scan's file set check (the prerendered pages equal `LIVE_SLUGS`) and its "Not approved" term prove a production build ignores the flag.
  - **What it needs.** Nothing from Doppler. Checked 16 Oct 2026: `next dev` in apps/web with an empty environment boots and serves pages. The slice route reads only committed files; `site.url` falls back to `http://localhost:3000`, so canonical and Open Graph URLs show localhost in the preview; with `SITE_GATE_PASSWORD` unset the gate is off; PostHog logs a console error and records nothing. Fonts (`next/font/google`) and the Viator images need a network connection. A card's `/go/tours` link does not work without the API (`API_BASE_URL`, `INTERNAL_CLICK_SECRET`), and the fact check read does not need it.

## Decision

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Route | Static `destinations/bangkok/[page]` folder | Prerenders; no edit to the redirect route | Merged `[slug]/[page]` (renders per request) |
| Layout | Own slice layout, no site chrome while gated | Keeps every link reachable (AC-T9) | Reuse the site header and footer |
| Structured data | `ItemList` of names and positions, `BreadcrumbList`, no author | No carousel is expected (recorded in scope); markup without urls cannot point at gated pages; no person to name | Full `Product` items |
| Disclosure text | Inline fixed template, publisher "Folio Voyage" | `/legal/disclosure` stays gated until its own PR; the business earns the commission | "The Folio team earns" |
| Page blocks | One template, blocks omitted when empty (D1) | One component set to test | A template per page |
| Rule line | Above the fold, no numbers (D6) | Criteria before picks (research lens 2); the bar itself is review data | The bar printed with its numbers |
| Stat strip | Up to 3 facts nearest an even split, between 20% and 80% or zero | A fact that splits the page tells a reader most; 90% "includes a guide" tells nothing | A fixed list per page |
| Hub | Category index on the same template | One template; the hub's job is routing to category pages | 10 cards in one list |
| Map | None (D8) | No coordinates in the slice | A static map |
| Preview | `seo:preview`, `next dev` only, banner on every page (AC-T15) | Roy reads a page before it can go live; a dev only switch cannot leak into a production build | A Vercel preview deploy, which would put unapproved pages on a public URL |

## Feature design

**Files**:
- `apps/web/src/app/destinations/bangkok/[page]/page.tsx` (route, metadata, JSON-LD, hash checks at build per index.md).
- `apps/web/src/app/destinations/bangkok/[page]/layout.tsx` (slice layout).
- `apps/web/src/components/seo-slice/` (`SlicePage`, `RuleLine`, `StatStrip`, `ChooseSections`, `HubIndex`, `LocalNotes`, `GoodToKnow`, `PickCard`, `HowMadeNote`, `SliceBreadcrumbs`, `SliceDisclosure`).
- `apps/web/src/lib/seo-slice/` (hash, live set reader, note, rule line and strip templates, leak scanner, `preview.ts`).
- `apps/web/package.json`: scripts `seo:preview` (AC-T15) and `seo:leak-scan` (AC-T6).

**Value sourcing**:
| Value | Source |
|---|---|
| H1, target query | manifest page |
| intro, title, description | copy file |
| picks, sections, length group, strip, hub one line facts, date | snapshot file (`facts` and `picks` only; never `eligible`) |
| checked date | `factCheck.at` in the copy file |
| rule line, note text | the AC-T12 and AC-T4 templates, filled from `tagNames`, `rule.plainWords`, `exclusions.plainWords`, the snapshot's section labels and the keyword group labels |
| tag names | a `tagNames` map in the manifest (`{ "20226": "Markets" }`), so the note never guesses |
| Local notes | `{slug}.notes.json`, verbatim |
| Good to know | manifest `sourceFacts` |
| disclosure text | the AC-T11 constant |
| og image | `ogImageExperienceId` in the manifest, resolved to a pick's `imageUrl` (AC-T5) |
| canonical | `site.url` |
| forbidden names | manifest `forbiddenNames`, filled by Roy |
| preview banner and its reasons | `isSlicePreview(env)` and the AC-2 derivation (AC-T15) |
| slugs to prerender | `LIVE_SLUGS`; in the preview only, every page with a snapshot and a copy file |

**Key invariants**:
- No `fetch` and no API client in the route.
- No rating, review, price, availability or cancellation term in server HTML (AC-T6).
- No personal name, no `Person`, no author (index.md AC-7).
- Notes are never transformed beyond HTML escaping.

**Critical test scenarios**:
- Build output lists the slice pages as prerendered, verifies **AC-T1**.
- Requests to `/destinations/bangkok`, `/destinations/bangkok/experiences/{id}` and `/destinations/thailand/bangkok` behave as today, verifies **AC-T2**.
- A fixture category page renders its blocks in the AC-T3 order; with no notes file, no source facts and an empty strip, those three blocks are absent; a one list page has no section sub headings, verifies **AC-T3**, **AC-T13**, **AC-T14**.
- The hub fixture renders one section per listed page with its link, one line fact and 2 cards, and no Local notes, verifies **AC-T3**.
- The note and rule line for every page, the hub's included, hold no digit and pass the leak scan; every category note ends with the photos sentence, verifies **AC-T4**, **AC-T12**.
- Leak scan on the built HTML of every live page; a fixture page whose script data holds `$1a` passes, one whose visible text holds `$12` fails, one whose note holds "entry fee 200 THB" fails, one whose visible text holds "Atlas" or the `factCheck.by` value fails, one with "our editors" fails, one with a `forbiddenNames` entry in its visible text fails, and one whose meta description, `og:title`, image `alt`, `aria-label` or `title` attribute holds "rated", "Atlas" or a `forbiddenNames` entry fails, verifies **AC-T6**, **AC-T7**, **AC-T11**.
- `isSlicePreview` is true only with `SEO_SLICE_PREVIEW=1`, `NODE_ENV=development` and no `VERCEL`; with the preview on, a fixture page with no `factCheck` renders with the banner and "Not checked yet"; with it off, that page is a 404; a production build with `SEO_SLICE_PREVIEW=1` prerenders exactly `LIVE_SLUGS` and no file holds "Not approved", verifies **AC-T15**, **AC-T1**.
- Printed counts are ungated: a fixture category page with `facts.memberCount: 431` (strip entries over 431) and `eligible.count: 217`, and a hub whose `facts.pages` says 431 for it, render "of 431" in the strip and "431 tours match its rule" on the hub, and the number 217 appears nowhere in either page's HTML or JSON-LD; the sentinels follow index.md AC-9 (no collision with a date, a year or a templated number), verifies **AC-T3**, **AC-T13** (index.md AC-9).
- A note with markup characters renders escaped and otherwise byte for byte, signed "Folio team" with its date, verifies **AC-T14**.
- Link audit with the flag unset and set; the only external hrefs are Good to know sources, verifies **AC-T8**, **AC-T9**.
- The Open Graph image is the `ogImageExperienceId` pick's image, verifies **AC-T5**.

## Build plan

1. Route, layout and the shared template for the hub (category index), from fixture files, satisfies **AC-T1**, **AC-T3**, **AC-T5**, **AC-T10**.
2. Rule line, checked line, stat strip, note template, disclosure and breadcrumbs, satisfies **AC-T4**, **AC-T8**, **AC-T11**, **AC-T12**, **AC-T13**.
3. Category page blocks: How to choose sections, Local notes, Good to know, satisfies **AC-T3**, **AC-T14**.
4. JSON-LD, satisfies **AC-T7**.
5. Leak, name and team scan over text, attributes and JSON-LD with its CI step (built with `SEO_SLICE_PREVIEW=1`), link audit and route regression tests, satisfies **AC-T2**, **AC-T6**, **AC-T9**.
6. The local preview script, `isSlicePreview` and the banner, satisfies **AC-T15**.

## Rationale (short)

The page has to show its working, so the curation logic is rendered from the same data that ran it, and the rule sits above the picks. The stat strip turns snapshot facts into reader value with no generated text. Local notes carry the only firsthand voice, so they are shown exactly as written and signed by the team that wrote them, never by a person. Hiding the site chrome while gated is cheaper than allowlisting more paths.
