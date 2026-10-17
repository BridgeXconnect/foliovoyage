# 0006. Stats page (child of 0006 SEO proving slice)

Scope row 25. Governed by [index.md](index.md): the snapshot and copy schemas live there.

## Summary

One page of facts computed across Bangkok's printable tours (the pool before the quality bar, index.md AC-9): how long tours run in each category, how often they include pickup, a meal, entry fees or a guide, and which places their titles name most. Every number shows its denominator, the words come from fixed templates (no model), and there are no price, rating or cancellation statistics. Only its SEO title and meta description are generated, and they are fact checked like the other pages. (Amended 16 Oct 2026: the method note no longer restates the quality bar's numbers, names Folio Voyage as publisher, holds no digits, and takes its keyword groups and places from the manifest. Every count is now over the printable pool, not the gated one. Each category table shows its median length; `categoryCounts` is gone. A stats page that fails is held, and the slice launches without it.)

## Requirements

**User stories**:
- As a travel writer, I want plain counts about Bangkok tours with their denominators, so that I can cite a number with confidence.
- As Roy, I want one linkable asset in the slice built from data I already have.

**Acceptance criteria**:
- **AC-D1**: The stats snapshot `facts` holds: `poolCount` (Experiences in the printable Bangkok pool, exactly the AC-M2a pool with no page rule applied); `durationByCategory`, for each category page that has a snapshot and is not held (the same set the hub lists, so no fact depends on which pages are live; which pages those are is decided on eligible members, AC-M6), `{ slug, memberCount, bandCounts, medianDurationMin }` over that page's printable members; `inclusionShares` over the whole pool for the manifest's `defaultKeywordGroupIds`, as in AC-S4 with `of` equal to `poolCount`; and `topPlaces`, up to 10 `{ name, count }` from the manifest `places` (AC-S8, no `excludePlaces`) over pool titles, count at least 2, ties by name. (`categoryCounts` is dropped: nothing rendered it, and each page's count is already `durationByCategory[].memberCount`.) No stats fact passes through the BRI-200 gate; the stats snapshot's `eligible` is null. `medianDurationMin` is over members with a non null `durationMin`: the middle value for an odd count, the mean of the two middle values rounded down to a whole minute for an even count, and null when no member has a duration.
- **AC-D2**: The page renders four sections from fixed templates: "How long tours run" (a table per category, headed by that page's `h1` linked to it when it is live, bands as counts and shares of `memberCount`, then a last row "Median length" showing `{medianDurationMin} minutes`, or "No lengths listed" when it is null), "What tours include" (each keyword group as `{count} of {of} ({percent}%)`), where every percent on the page is `count / of × 100` rounded half up to a whole number (`Math.floor(x + 0.5)`) and shown as 0 when `of` is 0, "Places tours name most" (a ranked list with counts out of `poolCount`), and "How these numbers were made" (opening with "Folio Voyage computed these numbers from every tour in Viator's Bangkok catalogue that matches the Bangkok rules on this site, including tours below the quality bar that decides which tours a page shows.", then "It leaves out {exclusions.plainWords}. The quality bar is set from Viator's own traveller feedback, and no number on this page depends on it." (D6: no numbers for the bar, no pass count), then the labels of the default keyword groups and the manifest `places` written out as lists). The method note holds no digits: the date is not repeated in it, since `Computed on {date}` is shown on the page (AC-D3), and the manifest strings it prints hold none (index.md). Under the H1 it shows the checked line (AC-T12). Every number shown is a value in the snapshot or a share computed from two of them.
- **AC-D3**: It shows `Computed on {date}`, the inline disclosure (AC-T11), the breadcrumb hub › "Bangkok tours by the numbers" (AC-T8), and links only to live slice pages (AC-T9). Its Open Graph image follows AC-T5; since its `checkHash` has no `picksHash`, it carries that pick's `imageUrl` as `ogImageUrl` (index.md Hashes), so a refresh that changes or drops that pick takes the page offline until Roy approves it again (and `approve` refuses until he picks one that exists, AC-H6).
- **AC-D4**: The page has no picks, no cards and no `ItemList`. JSON-LD is `BreadcrumbList` only.
- **AC-D5**: The leak, name and team scan (AC-T6) passes on the page, and a test asserts that every number in its HTML equals a snapshot value or a share recomputed from the snapshot.
- **AC-D6**: When the stats page fails generation or Roy's read, it is held and the slice launches without it (AC-H7). No other page lists it, so holding it needs no other regeneration.

## Decision

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Words | Fixed templates, no model | Every sentence is checkable by construction | Generated summaries |
| Denominator | Always shown | A share without its base is not citable | Percent only |
| Price, rating, cancellation | None | Viator terms (BRI-204) and the brief's scope | Rating bands |
| Quality bar wording | One clause, no numbers (D6) | The bar's values are review data in HTML | "at least 5 reviews and 4.0" as before |

## Feature design

Reuses the page route (`[page]` with `kind: "stats"` switching the body component to `StatsBody` in `apps/web/src/components/seo-slice/`). The facts are built in `seo-slice-facts.ts` beside the category facts.

**Value sourcing**:
| Value | Source |
|---|---|
| counts, medians, top places | stats snapshot `facts` |
| table headings | each listed category page's `h1` (in `checkHash` `rendered`, index.md) |
| percent | `count / of`, rounded half up (AC-D2), computed in the template |
| median | lower and upper middle mean, rounded down (AC-D1) |
| section words | fixed templates |
| title, description | stats copy file (AC-H7) |

**Critical test scenarios**:
- A fixture pool of 431 printable tours of which 217 pass the gate renders `poolCount` 431 and shares over 431, and 217 appears nowhere in the HTML or JSON-LD (sentinels per index.md AC-9), verifies **AC-D1**, **AC-D5** (index.md AC-9).
- A fixture pool with known counts renders the expected numbers and denominators, including an even count median (240 and 300 give 270), a share of exactly one half (1 of 8 is 12.5, shown as 13), and a category with no durations (median null), verifies **AC-D1**, **AC-D2**, **AC-D5**.
- Leak scan and link audit; the method note holds no digit and no "Atlas", and names "Folio Voyage"; every category table ends with its median row, verifies **AC-D2**, **AC-D3**, **AC-D5**.
- The breadcrumb is hub › stats, and its `BreadcrumbList` matches, verifies **AC-D3**.
- A refresh that drops the stats page's Open Graph pick changes its `checkHash`, so the page is not live until approved again, verifies **AC-D3**.

## Build plan

1. Stats facts in the snapshot command, satisfies **AC-D1**.
2. `StatsBody` with templates, satisfies **AC-D2**, **AC-D3**, **AC-D4**.
3. Number trace test, satisfies **AC-D5**.
4. Generate and fact check the stats copy; hold the page if it fails, satisfies **AC-D6**.
5. Once stats.snapshot.json exists, the preview lists stats; handle it (render the stats page or skip it) so the preview does not throw.

## Rationale (short)

Without price data the stats page is thin, so its value is that every figure is exact and sourced. Templates make that true by construction.
