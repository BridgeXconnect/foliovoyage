# 0006. Page manifest and tour membership rule (child of 0006 SEO proving slice)

Scope row 19. Governed by [index.md](index.md): the manifest schema and the representative tour rule live there.

## Summary

The manifest lists the 9 pages and, for each topic page, a rule written as data: a tour belongs when it carries one of the page's Viator tags or its title matches the page's pattern. Shared exclusions then drop off city tours (by place names in the title), multi day tours, transfers, Viator's flagged listings, and tours with no Viator link for `/go` to send a click to. Only tours that belong to a published Experience count. A page's members are its printable members (no BRI-200 gate); its eligible members are the ones that also pass the gate. Each category page splits its eligible members into per page groups (title patterns, first match wins), which become its "How to choose" sections. Inside a section, picks alternate across trip lengths, and inside a trip length a tour ranks by how many of the page's keyword groups its inclusions cover. Ordering never reads ratings, and coordinates are never used. Tours Roy flags for bad images are never picked. (Amended 16 Oct 2026; see index.md.) Printed counts come from the members; the floor, the section rule and the picks use the eligible members (index.md AC-9). In this spec "members" always means printable members, and the gated set is always called "eligible members".

## Requirements

**User stories**:
- As a searcher, I want a page's tours to match its topic and be in or near Bangkok, so that the page answers my query.
- As Roy, I want the rule written down as data, so that I can read it, widen it in a PR, and show it on the page.

**Acceptance criteria**:
- **AC-M1**: The manifest holds the 9 pages with these slugs, kinds and rules (tag ids and title patterns, case insensitive). `muay-thai` and `spa-and-massage` carry `"held": true` (decided 15 Oct 2026; they have 6 and 3 eligible members on prod), and their rules stay written so a later run can unhold them. Every category page except the two held ones matches by title only, with `tagIds: []`. `floating-markets`, `temples` and `cooking-classes` lost their tags on 16 Oct 2026 after the membership review (tag 20226 let in only a cooking class, 21518 let in general city tours, and 12034 let in cruises and food tours). `day-trips` and `cruises` lost theirs the same day after the picks review (tag 11889 let in city tours, and the cruise tags let in market tours that only ride a boat); the `day-trips` pattern now names the page's own places instead:

  | Slug | Kind | Target query | Tag ids | Title pattern |
  |---|---|---|---|---|
  | `things-to-do` | hub | things to do in bangkok | none | none |
  | `floating-markets` | category | bangkok floating market | none | `\bfloating markets?\b` |
  | `temples` | category | thailand temples bangkok | none | `\b(temples?\|wat arun\|wat pho\|wat phra kaew\|wat saket\|wat traimit\|grand palace\|emerald buddha\|reclining buddha)\b` |
  | `spa-and-massage` | category | spa and massage in bangkok | 12078 | `\b(spa\|massages?)\b` |
  | `muay-thai` | category | muay thai bangkok | 21532, 20227 | `\b(muay thai\|thai boxing)\b` |
  | `day-trips` | category | day trips from bangkok | none | `\b(day trips?\|ayutthaya\|kanchanaburi\|river kwai\|death railway\|erawan national park\|erawan falls\|erawan waterfalls?\|damnoen saduak\|maeklong\|railway market\|floating markets?\|khao yai)\b` |
  | `cooking-classes` | category | cooking class bangkok | none | `\bcooking (class\|classes\|school\|course)\b` |
  | `cruises` | category | bangkok cruise | none | `\b(cruises?\|dinner boat)\b` |
  | `stats` | stats | none | none | none |

  Each page's `h1` and, for category pages, its `rule.plainWords`:

  | Slug | H1 | Plain words |
  |---|---|---|
  | `things-to-do` | Things to do in Bangkok | none |
  | `floating-markets` | Floating market tours from Bangkok | floating market |
  | `temples` | Temple tours in Bangkok | temple, Wat Arun, Wat Pho, Wat Phra Kaew, Wat Saket, Wat Traimit, Grand Palace, Emerald Buddha or Reclining Buddha |
  | `spa-and-massage` | Spa and massage in Bangkok | spa or massage |
  | `muay-thai` | Muay thai in Bangkok | muay thai or Thai boxing |
  | `day-trips` | Day trips from Bangkok | day trip, Ayutthaya, Kanchanaburi, River Kwai, Death Railway, Erawan National Park, Erawan Falls, Erawan waterfall, Damnoen Saduak, Maeklong, railway market, floating market or Khao Yai |
  | `cooking-classes` | Cooking classes in Bangkok | cooking class, cooking school or cooking course |
  | `cruises` | Bangkok cruises | cruise or dinner boat |
  | `stats` | Bangkok tours by the numbers | none |

  Every `sourceFacts` list starts empty (index.md). `excludedExperiences` holds the five tours that run in Japanese (added 16 Oct 2026, AC-M10), and no page has `ogImageExperienceId` until Roy picks one in his fact check read (AC-H13).

  Each category page's `groups` (in this order, first match wins), `otherLabel`, `keywordGroupIds` and `excludePlaces`. Patterns are case insensitive against `Tour.title`:

  | Slug | Group id | Label | Title pattern |
  |---|---|---|---|
  | `floating-markets` | `damnoen-saduak` | Damnoen Saduak | `\bdamnoen saduak\b` |
  | | `maeklong` | With the Maeklong railway market | `\b(maeklong\|railway market)\b` |
  | | `ayutthaya` | Combined with Ayutthaya | `\bayutthaya\b` |
  | `temples` | `grand-palace` | Grand Palace and Wat Phra Kaew | `\b(grand palace\|wat phra kaew\|emerald buddha)\b` |
  | | `wat-arun-wat-pho` | Wat Arun and Wat Pho | `\b(wat arun\|wat pho\|reclining buddha)\b` |
  | | `ayutthaya` | Temples of Ayutthaya | `\bayutthaya\b` |
  | | `tuk-tuk-or-walking` | By tuk tuk or on foot | `\b(tuk[- ]?tuks?\|walking)\b` |
  | `day-trips` | `ayutthaya` | Ayutthaya | `\bayutthaya\b` |
  | | `floating-markets` | Floating markets | `\b(floating markets?\|damnoen saduak\|maeklong\|railway market)\b` |
  | | `kanchanaburi` | Kanchanaburi and Erawan | `\b(kanchanaburi\|river kwai\|death railway\|erawan (national park\|falls\|waterfalls?))\b` |
  | | `khao-yai` | Khao Yai | `\bkhao yai\b` |
  | `cooking-classes` | `market-visit` | With a market visit | `\bmarkets?\b` |
  | `cruises` | `dinner` | Dinner cruises | `\bdinner\b` |
  | | `ayutthaya` | River trips to Ayutthaya | `\bayutthaya\b` |
  | | `sunset` | Sunset cruises | `\bsunset\b` |

  On `day-trips`, the page rule and the `kanchanaburi` group name Erawan only as the national park and its falls, never on its own, so the Erawan Museum and the Erawan Shrine (both in or next to Bangkok) are not day trips. (Amended 16 Oct 2026; both used to match a bare `erawan`.)

  | Slug | `otherLabel` | `keywordGroupIds` | `excludePlaces` |
  |---|---|---|---|
  | `floating-markets` | Other floating market tours | default | Floating Market |
  | `temples` | Other temple tours | default | none |
  | `day-trips` | Other day trips | default | none |
  | `cooking-classes` | Other classes | `pickup`, `meal`, `marketVisit`, `recipe`, `vegetarian` | none |
  | `cruises` | Other cruises | `pickup`, `meal`, `guide`, `buffet`, `liveMusic`, `welcomeDrink` | none |

  The held pages keep empty `groups`, so if unheld they show one list until groups are added. The hub and stats have no `groups`.

- **AC-M2**: A tour is in the Bangkok pool when all hold: `deletedAt` is null; `destinationRefs` contains the manifest's `destinationRef` (`"343"`); its Experience exists and has `status = "published"`; it is that Experience's representative tour (index.md); `evaluateTourCopyEligibility` returns `eligible` (BRI-200: at least 5 reviews and a rating of at least 4.0); `imageUrl` is not null; and none of the exclusions in AC-M3 applies.
- **AC-M2a**: The **printable pool** is the AC-M2 pool without the `evaluateTourCopyEligibility` step: every other condition (not deleted, ref `343`, published Experience, representative tour, `imageUrl` not null, AC-M3 exclusions) still applies. A page's **printable members** are the printable pool tours that pass AC-M4. Its **eligible members** are the AC-M2 pool tours that pass AC-M4, so every eligible member is also a printable member. The plain word "members" means printable members everywhere in this spec; the gated set is always named "eligible members". Printable members feed every printed or generator facing count (AC-S4, AC-D1); eligible members feed only the floor (AC-M6), the section rule (AC-M5) and the picks.
- **AC-M3**: Shared exclusions, in the manifest's `exclusions` block: the title matches `offCityTitlePattern` (Phuket, Phi Phi, Krabi, Samui, Pattaya, Chiang Mai, Chiang Rai, Hua Hin, Koh Chang, Koh Samet, Koh Tao, Phangan, Laem Chabang; Ayutthaya is allowed; Koh Samet and Laem Chabang added 16 Oct 2026, the second because its tours are shore excursions from the cruise port). The places in `exclusions.plainWords` and the alternatives in `offCityTitlePattern` stay in step, and a test fails when they differ; `tags` contains any of `excludeTagIds` (11922 Multi day Tours, 12044 Airport and Hotel Transfers, 367651 DSA non compliant, 367656 Zombie, 367657 Zombie Slice); `durationMin` is greater than `maxDurationMin` (1440); or the title contains any term on the leak list (AC-T6), not only a price, availability or cancellation term: rating and review words, stars, price, availability and cancellation words, a currency next to a digit, and every other term on that list; or the representative tour's `affiliateUrl` fails `isViatorHost` (null, not `https`, or a host other than `viator.com` or a subdomain of it). Tag 367668 (Agent Low Quality Product) is not excluded.
  - **One host check.** `isViatorHost` is the function `/go/tours/:id` and `/go/:slug/:id` already apply (`apps/web/src/lib/viator-url.ts`, spec 0005 AC-9). It moves, unchanged and with its tests, to `packages/shared/src/viator-url.ts`; `apps/web/src/lib/viator-url.ts` re-exports it, so both `/go` routes keep their import and call the same function. No second definition is written. The exclusion takes no manifest setting; `exclusions.plainWords` names it (index.md).
  - **Load check before building on it.** index.md (Manifest home) records that the CommonJS API cannot `require` the ESM shared package, and today apps/api imports only types from it at runtime. Before `selectMembers` depends on `isViatorHost`, the builder confirms `seo:snapshot` (through `ts-node`) can load it. If it cannot, stop and bring it back to Roy; do not copy the function into apps/api.
  - **Effect on counts.** The exclusion is part of AC-M3, so it drops the tour from the printable pool (AC-M2a) and from the eligible pool (AC-M2) alike: `facts.*` and `eligible.*` both shrink by the same tours, and a page can become thin (AC-M6). How many Bangkok representative tours fail the check is not measured (rationale.md).
- **AC-M4**: A pool tour is a member of a category page when its `tags` contain any of the page's tag ids or its title matches the page's pattern. A page with `tagIds: []` matches by title alone. One Experience counts once per page. Members may appear on more than one category page.
- **AC-M5**: Sections and order on a category page.
  - **Sections.** Each eligible member goes to the first of the page's `groups` whose `titlePattern` matches its title, else to `other`. A named group with fewer than 3 eligible members is folded into `other`. The sections are the named groups left, in manifest order, then `other` (titled `otherLabel`) when it has at least 3 eligible members. An `other` with fewer than 3 eligible members is not a section: its members count in the facts but are not picked. When fewer than 2 sections result, the page has no sections, and all its eligible members form one list. These eligible counts are stored in the snapshot's `eligible.sections` (index.md) and never printed.
  - **Printable section counts.** Once the sections are fixed, each printable member goes to the first named group, in manifest order, whose pattern matches its title. If that group was folded into `other`, or no group matches, the member counts under `other`. It never moves on to a later group: a tour whose title matches a folded group and also a later, kept group counts under `other`, not under the later group. Its count is `facts.sections[].memberCount`. A member whose place is `other` when `other` is not a section is in no section count (it still counts in `memberCount`). With one list, `facts.sections` is `[]`.
  - **Order inside a section** (or inside the one list). Split the section's eligible members by length group: `under4h` for under 240 minutes, `4to8h` for 240 to 479, `fullDay` for 480 or more, `unknown` when `durationMin` is null. Inside a length group, order by the number of the page's keyword groups (AC-S8, the page's `keywordGroupIds`) that at least one of the eligible member's inclusion texts matches, descending, then by `providerTourId` ascending. An inclusion's text is as in AC-S4. Then take eligible members round robin: the first remaining one of each non empty length group, and repeat until the section is used up. The known length groups (`under4h`, `4to8h`, `fullDay`) go in order of their eligible member count in the section, descending, with ties in the order `under4h`, `4to8h`, `fullDay`; `unknown` always goes last. (Amended 16 Oct 2026; the order used to be fixed as `under4h`, `4to8h`, `fullDay`, `unknown`.)
  - No rating, review count or price field is read for any of this.
- **AC-M6**: Picks. Each section takes the first 3 eligible members in its AC-M5 order; the one list takes the first 12. An eligible member on `excludedExperiences` (AC-M10) is skipped and the next one takes its place. Picks are stored in render order: sections in order, each section's picks in round robin order, each with its `section` id (index.md). When a page has fewer than 10 eligible members (`eligible.count`), it is thin: the snapshot command deletes any file it had and writes none (AC-S6), and the page is held. The printable count never decides thinness.
- **AC-M7**: The hub walks the category pages that have a snapshot and are not held, in manifest order. From each it takes the first 2 of that page's picks, in render order, whose Experience the hub has not already taken, moving down past any repeat, so each page gives 2 cards when it has 2 unused picks. Each hub pick records `fromSlug`. With 5 such pages today that is 10 cards (14 if both held pages return). A page that is thin (AC-M6) or held contributes no cards, no facts and no link. When fewer than 2 pages contribute cards, the hub itself is thin and gets no snapshot (AC-S6). The hub does no hiding at render: it is live only when every page it lists is ready (index.md AC-2), so what it shows is always live.
- **AC-M8**: Membership, sections and picks are pure functions in `apps/api/src/modules/content/seo-slice-membership.ts` (`selectMembers(tours, manifest)`, returning both the printable and the eligible members per page, and `selectPicks(members, page, manifest)`), with no database, network or clock access. Its tests include a fixture for every named off city case (a Phuket, a Phi Phi, a Krabi, a Samui, both Pattaya floating market titles, a Koh Samet island trip and a Laem Chabang shore excursion) and assert none is a member of any page, and an Ayutthaya day trip that is.
- **AC-M9**: A test asserts that no manifest slug equals a destination slug in `apps/web/src/data/destinations.ts`, and that slugs are unique.
- **AC-M10**: `excludedExperiences` (index.md) holds Experiences Roy flagged in a fact check or picks review read (a bad image, or a tour that runs in a language other than English), each with a non empty `reason`. A flagged Experience stays a member (facts count it) and is never picked, on any category page or the hub. A test asserts both, and that an entry without a `reason` fails manifest validation.

## Decision

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Rule shape | Tag ids OR title pattern, per page | Tag coverage is thin (floating markets: 1 tag, 203 titles; temples: 69 tags, 372 titles) | Tags only |
| Off city | Place names in the title | Off city tours are filed under ref `343` alone, and 612 Bangkok tours have no coordinates | A radius on coordinates |
| Flagged tours | Drop DSA non compliant, Zombie, Zombie Slice | Viator's own signals that a listing is broken or non compliant | Keep all |
| Agent Low Quality | Keep | Its basis may come from reviews, so using it would rank by reviews | Drop |
| Sections | Per page groups by title pattern, first match wins, at least 3 eligible members each | Readers pick by place or by dinner first; title patterns are testable data | Length groups as sections |
| Ordering | Round robin across length groups inside each section, the known length groups by eligible member count descending and `unknown` last; then distinct keyword groups covered; then provider id | The 16 Oct dry run showed the old rule filled every page from one length group; raw counts reward padded lists | Length group, inclusion count, provider id (the old rule) |
| Picks | 3 per section, 12 for one list | Every section gets a comparable set; total stays near 12 | 12 split by section size |
| Bad images | Manifest exclusion list with a reason, picks only | Roy's eye is the check; facts stay true to the pool | Drop from membership |
| Floor | 10 eligible members, else hold the page | A page with fewer is not a curated page | No floor |
| Printed counts | Printable members (no gate); gated counts internal | Gated counts are review derived (index.md AC-9) | Print gated counts |
| Affiliate URL | Exclude a tour whose representative tour fails `isViatorHost`, the `/go` check, moved to `@folio/shared` | A picked card must lead to that tour's Viator page, not the city search fallback; one definition of a Viator URL | List it weekly and leave it (the earlier AC-R10 behaviour) |

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
| Eligibility | gate (eligible members only; skipped for printable members) | `evaluateTourCopyEligibility(Tour)` |
| Sections | group | `Tour.title` against each `groups[].titlePattern`, in order |
| Ordering | length group | `Tour.durationMin` |
| Ordering | keyword groups covered | `Tour.inclusions` texts against the page's keyword groups (AC-S8) |
| Ordering | tie break | `Tour.providerTourId` |
| Picks | skip | `excludedExperiences[].experienceId` |
| Exclusion | affiliate URL | `Tour.affiliateUrl` of the representative tour, through `isViatorHost` (`@folio/shared`) |

**Key invariants**:
- No coordinate field is read.
- Ratings are read only by the BRI-200 gate, as a yes or no, and no count that passed through it is printed.

**Critical test scenarios**:
- Off city fixtures are excluded and the Ayutthaya fixture is kept, verifies **AC-M3**, **AC-M8**.
- Tours whose `affiliateUrl` is null, `http://www.viator.com/...`, `https://evilviator.com/...` or `https://viator.com.evil.com/...` are in neither member set, and `https://www.viator.com/...` is kept; the test imports `isViatorHost` from `@folio/shared`, and a test in apps/web asserts `@/lib/viator-url` exports that same function, verifies **AC-M3**, **AC-M2a**.
- A tour matching by tag only and one matching by title only are both members, verifies **AC-M4**.
- A tour whose title names Damnoen Saduak and Maeklong lands in `damnoen-saduak` only; a group of 2 folds into `other`; a page with one named section and an `other` of 2 shows one list, verifies **AC-M5**.
- A section with 2 under 4 hour, 0 middle, 1 full day and 3 unknown eligible members picks under 4 hours, full day, unknown in that order; a tour covering 3 keyword groups with 3 inclusions beats one covering 1 group with 9 inclusions; a null duration goes to `unknown`, verifies **AC-M5**.
- A section yields 3 picks and the one list 12; a page with 9 eligible members (and 40 members) is thin, verifies **AC-M6**.
- Hub with an Experience at the top of two categories appears once, and the second category gives its next pick instead, with `fromSlug` set on each pick, verifies **AC-M7**.
- A fixture with 431 printable and 217 eligible members on one page: `selectMembers` returns both sets, the floor and the section rule use 217, and a group with 2 eligible and 6 printable members is folded into `other`, verifies **AC-M2a**, **AC-M5**, **AC-M6**.
- A flagged Experience is counted in `memberCount` but appears in no pick list, and the next member takes its place, verifies **AC-M10**.
- On the prod snapshot, no live page draws all its picks from one length group when another length group has eligible members, checked in the first snapshot report.

## Build plan

1. Write `manifest.json` with the 9 pages, exclusions, keyword groups, places, per page groups and keyword sets, and fill `tagNames` from Viator's `/products/tags` (the research module's `ViatorCatalog` already caches it in `research-data/viator/tags.json`), satisfies **AC-M1**, **AC-M3**.
2. Move `isViatorHost` to `@folio/shared` with its tests and re-export it from `apps/web/src/lib/viator-url.ts`, then confirm `seo:snapshot` can load it (AC-M3). Then `seo-slice-membership.ts` (`selectMembers`, `selectPicks`) and tests, satisfies **AC-M2**, **AC-M2a** to **AC-M8**, **AC-M10**.
3. The slug test in apps/web, satisfies **AC-M9**.

## Rationale (short)

The rule has to be readable by a person and printable on the page ("How this page was made"), so it is data, not code. Titles carry the topic and the place far more often than tags do, so the rule needs both. The floor holds a page back rather than padding it. Sections and the round robin come from the content research (index.md, rationale.md): readers choose by place or by what's included, and the old order filled whole pages from one trip length.
