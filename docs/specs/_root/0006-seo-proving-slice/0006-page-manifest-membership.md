# 0006. Page manifest and tour membership rule (child of 0006 SEO proving slice)

Scope row 19. Governed by [index.md](index.md): the manifest schema and the representative tour rule live there.

## Summary

The manifest lists the 9 pages and, for each topic page, a rule written as data: a tour belongs when it carries one of the page's Viator tags or its title matches the page's pattern. Shared exclusions then drop off city tours (by place names in the title), multi day tours, transfers and Viator's flagged listings. Only tours that pass the BRI-200 gate and belong to a published Experience count. Ordering uses duration, inclusions and the provider id, never ratings, and coordinates are never used.

## Requirements

**User stories**:
- As a searcher, I want a page's tours to match its topic and be in or near Bangkok, so that the page answers my query.
- As Roy, I want the rule written down as data, so that I can read it, widen it in a PR, and show it on the page.

**Acceptance criteria**:
- **AC-M1**: The manifest holds the 9 pages with these slugs, kinds and rules (tag ids and title patterns, case insensitive). `muay-thai` and `spa-and-massage` carry `"held": true` (decided 15 Oct 2026; they have 6 and 3 eligible members on prod), and their rules stay written so a later run can unhold them:

  | Slug | Kind | Target query | Tag ids | Title pattern |
  |---|---|---|---|---|
  | `things-to-do` | hub | things to do in bangkok | none | none |
  | `floating-markets` | category | bangkok floating market | 20226 | `\bfloating markets?\b` |
  | `temples` | category | thailand temples bangkok | 21518 | `\b(temples?\|wat arun\|wat pho\|wat phra kaew\|wat saket\|wat traimit\|grand palace\|emerald buddha\|reclining buddha)\b` |
  | `spa-and-massage` | category | spa and massage in bangkok | 12078 | `\b(spa\|massages?)\b` |
  | `muay-thai` | category | muay thai bangkok | 21532, 20227 | `\b(muay thai\|thai boxing)\b` |
  | `day-trips` | category | day trips from bangkok | 11889 | `\bday trips?\b` |
  | `cooking-classes` | category | cooking class bangkok | 12034 | `\bcooking (class\|classes\|school\|course)\b` |
  | `cruises` | category | bangkok cruise | 11885, 21729, 11887, 11963, 11965 | `\b(cruises?\|dinner boat)\b` |
  | `stats` | stats | none | none | none |

  Each page's `h1` and, for category pages, its `rule.plainWords`:

  | Slug | H1 | Plain words |
  |---|---|---|
  | `things-to-do` | Things to do in Bangkok | none |
  | `floating-markets` | Floating market tours from Bangkok | floating market |
  | `temples` | Temple tours in Bangkok | temple, Wat Arun, Wat Pho, Wat Phra Kaew, Wat Saket, Wat Traimit, Grand Palace, Emerald Buddha or Reclining Buddha |
  | `spa-and-massage` | Spa and massage in Bangkok | spa or massage |
  | `muay-thai` | Muay thai in Bangkok | muay thai or Thai boxing |
  | `day-trips` | Day trips from Bangkok | day trip |
  | `cooking-classes` | Cooking classes in Bangkok | cooking class, school or course |
  | `cruises` | Bangkok cruises | cruise or dinner boat |
  | `stats` | Bangkok tours by the numbers | none |

  Every `sourceFacts` list starts empty (index.md).

- **AC-M2**: A tour is in the Bangkok pool when all hold: `deletedAt` is null; `destinationRefs` contains the manifest's `destinationRef` (`"343"`); its Experience exists and has `status = "published"`; it is that Experience's representative tour (index.md); `evaluateTourCopyEligibility` returns `eligible` (BRI-200: at least 5 reviews and a rating of at least 4.0); `imageUrl` is not null; and none of the exclusions in AC-M3 applies.
- **AC-M3**: Shared exclusions, in the manifest's `exclusions` block: the title matches `offCityTitlePattern` (Phuket, Phi Phi, Krabi, Samui, Pattaya, Chiang Mai, Chiang Rai, Hua Hin, Koh Chang, Koh Tao, Phangan; Ayutthaya is allowed); `tags` contains any of `excludeTagIds` (11922 Multi day Tours, 12044 Airport and Hotel Transfers, 367651 DSA non compliant, 367656 Zombie, 367657 Zombie Slice); `durationMin` is greater than `maxDurationMin` (1440); or the title contains a price, availability or cancellation term from the leak list (AC-T6). Tag 367668 (Agent Low Quality Product) is not excluded.
- **AC-M4**: A pool tour is a member of a category page when its `tags` contain any of the page's tag ids or its title matches the page's pattern. One Experience counts once per page. Members may appear on more than one category page.
- **AC-M5**: Members are ordered by duration band (`under4h` for under 240 minutes, `4to8h` for 240 to 479, `fullDay` for 480 or more, `unknown` when `durationMin` is null, in that order), then by inclusion count descending, then by `providerTourId` ascending. No rating, review count or price field is read for ordering.
- **AC-M6**: A category page takes the first 12 ordered members as picks. When it has fewer than 10 members, the page is thin: the snapshot command writes no file for it (AC-S6).
- **AC-M7**: The hub walks the category pages that have a snapshot and are not held, in manifest order. From each it takes the first 2 of that page's ordered members whose Experience the hub has not already taken, moving down the list past any repeat, so each page gives 2 cards when it has 2 unused members. Each hub pick records `fromSlug`. With 5 such pages today that is 10 cards (14 if both held pages return). A page that is thin (AC-M6) or held contributes no cards, no facts and no link. The hub does no hiding at render: it is live only when every page it lists is ready (index.md AC-2), so what it shows is always live.
- **AC-M8**: Membership is a pure function, `selectMembers(tours, manifest)` in `apps/api/src/modules/content/seo-slice-membership.ts`, with no database, network or clock access. Its tests include a fixture for every named off city case (a Phuket, a Phi Phi, a Krabi, a Samui and both Pattaya floating market titles) and assert none is a member of any page, and an Ayutthaya day trip that is.
- **AC-M9**: A test asserts that no manifest slug equals a destination slug in `apps/web/src/data/destinations.ts`, and that slugs are unique.

## Decision

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Rule shape | Tag ids OR title pattern, per page | Tag coverage is thin (floating markets: 1 tag, 203 titles; temples: 69 tags, 372 titles) | Tags only |
| Off city | Place names in the title | Off city tours are filed under ref `343` alone, and 612 Bangkok tours have no coordinates | A radius on coordinates |
| Flagged tours | Drop DSA non compliant, Zombie, Zombie Slice | Viator's own signals that a listing is broken or non compliant | Keep all |
| Agent Low Quality | Keep | Its basis may come from reviews, so using it would rank by reviews | Drop |
| Ordering | Duration band, inclusion count, provider id | Static fields only, stable across reruns | Ratings |
| Floor | 10 members, else hold the page | A page with fewer is not a curated page | No floor |

## Feature design

**Measured on prod, read only, 15 Oct 2026** (this rule, pool and gate as written):

| Page | Title or tag matches | Eligible members |
|---|---|---|
| `floating-markets` | 171 | 78 |
| `temples` | 387 | 134 |
| `spa-and-massage` | 35 | **3** |
| `muay-thai` | 24 | **6** |
| `day-trips` | 453 | 192 |
| `cooking-classes` | 56 | 22 |
| `cruises` | 248 | 55 |

Counted per Experience before the representative tour step, so the final counts can be a little lower. The two bold pages are under the floor today and are held (AC-M1). (In the AC-M1 table, `\|` is a table escape; the manifest holds a plain `|`.)

**Value sourcing**:
| Action | Value | Source |
|---|---|---|
| Membership | tag match | `Tour.tags` against `rule.tagIds` |
| Membership | title match | `Tour.title` against `rule.titlePattern` |
| Eligibility | gate | `evaluateTourCopyEligibility(Tour)` |
| Ordering | band | `Tour.durationMin` |
| Ordering | inclusion count | length of `Tour.inclusions` (array, else 0) |
| Ordering | tie break | `Tour.providerTourId` |

**Key invariants**:
- No coordinate field is read.
- Ratings are read only by the BRI-200 gate, as a yes or no.

**Critical test scenarios**:
- Off city fixtures are excluded and the Ayutthaya fixture is kept, verifies **AC-M3**, **AC-M8**.
- A tour matching by tag only and one matching by title only are both members, verifies **AC-M4**.
- Ordering with a null duration and equal inclusion counts, verifies **AC-M5**.
- A page with 9 members is thin, verifies **AC-M6**.
- Hub with an Experience at the top of two categories appears once, and the second category gives its next member instead, with `fromSlug` set on each pick, verifies **AC-M7**.

## Build plan

1. Write `manifest.json` with the 9 pages and exclusions, and fill `tagNames` from Viator's `/products/tags` (the research module's `ViatorCatalog` already caches it in `research-data/viator/tags.json`), satisfies **AC-M1**, **AC-M3**.
2. `seo-slice-membership.ts` and tests, satisfies **AC-M2** to **AC-M8**.
3. The slug test in apps/web, satisfies **AC-M9**.

## Rationale (short)

The rule has to be readable by a person and printable on the page ("How this page was made"), so it is data, not code. Titles carry the topic and the place far more often than tags do, so the rule needs both. The floor holds a page back rather than padding it.
