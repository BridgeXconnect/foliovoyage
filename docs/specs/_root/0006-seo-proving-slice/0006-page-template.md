# 0006. Page template and URL (child of 0006 SEO proving slice)

Scope row 21. Governed by [index.md](index.md): the live set, generated files and copy schema live there.

## Summary

One static route, `apps/web/src/app/destinations/bangkok/[page]/page.tsx`, renders every live slice page from its committed files. It is proven first on the hub (`things-to-do`). Each page shows its intro, its picks grouped by duration band, a "How this page was made" note written from the manifest rule, the computed on date and the affiliate disclosure. Structured data carries names and positions only, and a leak test checks the HTML for any rating, price, availability or cancellation term.

## Requirements

**User stories**:
- As a searcher, I want to see why these tours were picked and when the data was checked, so that I can trust the list.
- As Roy, I want the page to link only to places a visitor can reach while gated, so that nobody lands on the coming soon page from a slice page.

**Acceptance criteria**:
- **AC-T1**: The route prerenders one page per slug in `LIVE_SLUGS` (`generateStaticParams`) with `dynamicParams = false`, so any other `/destinations/bangkok/{x}` returns 404. The build output marks these pages static (prerendered), not dynamic.
- **AC-T2**: `/destinations/bangkok` is still served by `apps/web/src/app/destinations/[slug]/page.tsx`, `/destinations/bangkok/experiences/{experienceId}` is still served by `[slug]/experiences/[experienceId]/page.tsx`, and `/destinations/thailand/bangkok` still 308 redirects to `/destinations/bangkok`. None of those three files is edited. A route test requests all three after the new folder exists.
- **AC-T3**: A category page renders, in order: the H1 from the manifest; the intro from the copy file; the picks grouped under templated band headings (`Under 4 hours`, `4 to 8 hours`, `A full day`, `Duration not listed`), empty bands omitted; the "How this page was made" note; `Computed on {d MMMM yyyy}` from the snapshot; and the disclosure text. The hub renders, under its H1 and intro, a link to each category page it lists (text: that page's H1), then its cards in one list, then the same note, date and disclosure. Since the hub is live only when every page it lists is live (index.md AC-2), it hides nothing at render.
- **AC-T4**: The "How this page was made" note is a fixed template filled from manifest data, with no generated text. On a category page it reads, with `{tags}` being the page's tag names from `tagNames` joined with "or" in manifest order:

  > This page lists tours from Viator's Bangkok catalogue that carry the Viator tag {tags}, or whose titles mention {rule.plainWords}. It leaves out {exclusions.plainWords}. It shows only tours that meet Viator's own traveller score bar, at least 5 scores averaging 4.0 or more; that bar decides whether a tour appears, never where. Tours are grouped by length, then listed by how many inclusions they name, then by Viator's product code.

  On the hub, the first sentence is "This page takes 2 tours from each of the Bangkok topic pages linked above, each chosen by that page's own rule." and the rest is the same. A test renders the note for every page and runs the leak scan over it.
- **AC-T5**: Metadata: `title` = copy `seoTitle`; `description` = copy `metaDescription`; canonical `{site.url}/destinations/bangkok/{slug}`; `robots: { index: true, follow: true }`; Open Graph title, description and image. The image is the first pick's `imageUrl`. The stats page has no picks, so it uses the first pick of the category page with the largest `memberCount` in its `durationByCategory` (ties by manifest order).
- **AC-T6**: The leak scan, `pnpm --filter @folio/web seo:leak-scan`, runs after `next build` over `.next/server/app/destinations/bangkok/*.html`. For each file it takes the visible text (the HTML with every `<script>` and `<style>` element removed, then tags stripped and entities decoded) plus the contents of each `<script type="application/ld+json">`, and fails on any match, case insensitive. It skips the other scripts on purpose, because the framework's page data holds tokens like `$1a` that would trip the currency rule. It also fails when the set of files does not equal `LIVE_SLUGS`, which proves every live page prerendered. CI gains a step in the `lint-typecheck-test` job: `pnpm --filter @folio/web build && pnpm --filter @folio/web seo:leak-scan`. Terms matched at the start of a word: `rating`, `rated`, `review`, `price`, `availab`, `cancel`, `refund`. Whole words or phrases: `stars`, `sold out`, `book now`, `spots left`, `from` followed by a currency. Symbols: `★`, and any currency symbol or ISO code next to a digit (`$`, `€`, `£`, `฿`, `USD`, `THB`, `EUR`, `GBP`). The list is one exported constant, `SEO_SLICE_LEAK_TERMS`, in `packages/shared/src/seo-slice.ts` (types and data only, so apps/api copies it into its own constants file and a parity test in apps/api reads the shared source file as text and compares). The snapshot (AC-S5, AC-M3) and copy checks (AC-H3) use the same list, applied to plain strings.
- **AC-T11**: The disclosure (`SliceDisclosure`) is this fixed text, shown in full on every slice page: "Atlas earns a commission when you book a tour through the Viator links on this page, at no extra cost to you. The tours are chosen by the rule in How this page was made, not by commission."
- **AC-T7**: JSON-LD holds two objects: `BreadcrumbList` and `ItemList`. `ItemList.itemListElement` is `ListItem { position, name }` per pick, with no `url`, `item`, `offers`, `aggregateRating` or `review`.
- **AC-T8**: Breadcrumbs: on a category page, hub then the page (`Things to do in Bangkok` › page H1); on the hub, a single crumb. When the build time flag `SEO_SLICE_SITE_LINKS=1`, both start with `Home` › `Bangkok` (`/`, `/destinations/bangkok`). The visible breadcrumb and `BreadcrumbList` always match.
- **AC-T9**: With `SEO_SLICE_SITE_LINKS` unset, every internal `href` in a slice page's HTML is a live slice path or starts with `/go/tours/`. The page uses its own slice layout with no site header or footer links (no link to `/legal/disclosure`, which stays gated); the disclosure is shown in full inline.
- **AC-T10**: Images use `next/image` with the pick's `imageUrl` (hosts are `media-cdn.tripadvisor.com` and `dynamic-media-cdn.tripadvisor.com`, already covered by `**.tripadvisor.com` in `remotePatterns`) and `imageAlt`.

## Decision

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Route | Static `destinations/bangkok/[page]` folder | Prerenders; no edit to the redirect route | Merged `[slug]/[page]` (renders per request) |
| Layout | Own slice layout, no site chrome while gated | Keeps every link reachable (AC-T9) | Reuse the site header and footer |
| Structured data | `ItemList` of names and positions, `BreadcrumbList` | No carousel is expected (recorded in scope); markup without urls cannot point at gated pages | Full `Product` items |
| Disclosure text | Inline fixed template | `/legal/disclosure` stays gated until its own PR | Link to the legal page |

## Feature design

**Files**:
- `apps/web/src/app/destinations/bangkok/[page]/page.tsx` (route, metadata, JSON-LD, hash checks at build per index.md).
- `apps/web/src/app/destinations/bangkok/[page]/layout.tsx` (slice layout).
- `apps/web/src/components/seo-slice/` (`SlicePage`, `PickCard`, `HowMadeNote`, `SliceBreadcrumbs`, `SliceDisclosure`).
- `apps/web/src/lib/seo-slice/` (hash, live set reader, note template, leak scanner).

**Value sourcing**:
| Value | Source |
|---|---|
| H1, target query | manifest page |
| intro, title, description | copy file |
| picks, band, date | snapshot file |
| note text | the AC-T4 template, filled from `rule.plainWords` and `exclusions.plainWords` |
| tag names in the note | a `tagNames` map in the manifest (`{ "20226": "Markets" }`), so the note never guesses |
| disclosure text | the AC-T11 constant |
| stats og image | the largest category page's first pick (AC-T5) |
| canonical | `site.url` |

**Key invariants**:
- No `fetch` and no API client in the route.
- No rating, review, price, availability or cancellation term in server HTML (AC-T6).

**Critical test scenarios**:
- Build output lists the slice pages as prerendered, verifies **AC-T1**.
- Requests to `/destinations/bangkok`, `/destinations/bangkok/experiences/{id}` and `/destinations/thailand/bangkok` behave as today, verifies **AC-T2**.
- Leak scan on the built HTML of every live page; a fixture page whose script data holds `$1a` passes, and one whose visible text holds `$12` fails, verifies **AC-T6**, **AC-T7**, **AC-T11**.
- Link audit with the flag unset and set, verifies **AC-T8**, **AC-T9**.

## Build plan

1. Route, layout and components for the hub, from fixture files, satisfies **AC-T1**, **AC-T3**, **AC-T5**, **AC-T10**.
2. Note template, disclosure and breadcrumbs, satisfies **AC-T4**, **AC-T8**, **AC-T11**.
3. JSON-LD, satisfies **AC-T7**.
4. Leak scan script and its CI step, link audit and route regression tests, satisfies **AC-T2**, **AC-T6**, **AC-T9**.

## Rationale (short)

The page has to show its working, so the curation logic is rendered from the same data that ran it. Hiding the site chrome while gated is cheaper than allowlisting more paths.
