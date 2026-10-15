# 0006. Stats page (child of 0006 SEO proving slice)

Scope row 25. Governed by [index.md](index.md): the snapshot and copy schemas live there.

## Summary

One page of facts computed across Bangkok's eligible tours: how long tours run in each category, how often they include pickup, a meal, entry fees or a guide, and which places their titles name most. Every number shows its denominator, the words come from fixed templates (no model), and there are no price, rating or cancellation statistics. Only its SEO title and meta description are generated, and they are fact checked like the other pages.

## Requirements

**User stories**:
- As a travel writer, I want plain counts about Bangkok tours with their denominators, so that I can cite a number with confidence.
- As Roy, I want one linkable asset in the slice built from data I already have.

**Acceptance criteria**:
- **AC-D1**: The stats snapshot `facts` holds: `poolCount` (Experiences in the Bangkok pool, exactly the AC-M2 pool with no page rule applied); `durationByCategory`, for each category page that has a snapshot and is not held (the same set the hub lists, so no fact depends on which pages are live), `{ slug, memberCount, bandCounts, medianDurationMin }`; `inclusionShares` over the whole pool, as in AC-S4 with `of` equal to `poolCount`; `topPlaces`, up to 10 `{ name, count }` from the place list (AC-S8) over pool titles, count at least 2, ties by name; and `categoryCounts`, the number of pool members on each of those category pages (a member can count on several). `medianDurationMin` is over members with a non null `durationMin`: the middle value for an odd count, the mean of the two middle values rounded down to a whole minute for an even count, and null when no member has a duration.
- **AC-D2**: The page renders four sections from fixed templates: "How long tours run" (a table per category, bands as counts and shares of `memberCount`), "What tours include" (each keyword group as `{count} of {of} ({percent}%)`), where every percent on the page is `count / of × 100` rounded half up to a whole number (`Math.floor(x + 0.5)`) and shown as 0 when `of` is 0, "Places tours name most" (a ranked list with counts out of `poolCount`), and "How these numbers were made" (opening with "These numbers cover every tour in Viator's Bangkok catalogue that Atlas could show on any page.", then the AC-T4 sentences on what is left out and the score bar, the date, and the keyword groups and place list from AC-S8 written out as lists). Every number shown is a value in the snapshot or a share computed from two of them.
- **AC-D3**: It shows `Computed on {date}`, the inline disclosure (AC-T11), and links only to live slice pages (AC-T9). Its Open Graph image follows AC-T5.
- **AC-D4**: The page has no picks, no cards and no `ItemList`. JSON-LD is `BreadcrumbList` only.
- **AC-D5**: The leak test (AC-T6) passes on the page, and a test asserts that every number in its HTML equals a snapshot value or a share recomputed from the snapshot.

## Decision

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Words | Fixed templates, no model | Every sentence is checkable by construction | Generated summaries |
| Denominator | Always shown | A share without its base is not citable | Percent only |
| Price, rating, cancellation | None | Viator terms (BRI-204) and the brief's scope | Rating bands |

## Feature design

Reuses the page route (`[page]` with `kind: "stats"` switching the body component to `StatsBody` in `apps/web/src/components/seo-slice/`). The facts are built in `seo-slice-facts.ts` beside the category facts.

**Value sourcing**:
| Value | Source |
|---|---|
| counts, medians, top places | stats snapshot `facts` |
| percent | `count / of`, rounded half up (AC-D2), computed in the template |
| median | lower and upper middle mean, rounded down (AC-D1) |
| section words | fixed templates |
| title, description | stats copy file (AC-H7) |

**Critical test scenarios**:
- A fixture pool with known counts renders the expected numbers and denominators, including an even count median (240 and 300 give 270), a share of exactly one half (1 of 8 is 12.5, shown as 13), and a category with no durations (median null), verifies **AC-D1**, **AC-D2**, **AC-D5**.
- Leak scan and link audit, verifies **AC-D3**, **AC-D5**.

## Build plan

1. Stats facts in the snapshot command, satisfies **AC-D1**.
2. `StatsBody` with templates, satisfies **AC-D2**, **AC-D3**, **AC-D4**.
3. Number trace test, satisfies **AC-D5**.

## Rationale (short)

Without price data the stats page is thin, so its value is that every figure is exact and sourced. Templates make that true by construction.
