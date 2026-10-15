# 0006. SEO proving slice, Bangkok (BRI-114)

**Date**: 2026-10-15
**Status**: In Progress
**Amended**: 2026-10-16, after the content research (`~/folio-logs/seo-content-research/`, decisions D1 to D10). The amendment changes the page design (rows 19 to 25). Row 18 now opens `/go/tours/` and `/ingest/` only when the live set is non-empty. Amended again the same day before acceptance: printed numbers come from the printable pool (AC-9), a CI guard keeps live pages live (AC-8), `seo:clicks` lists picks that no longer resolve (AC-R10), a hub that fails calibration stops the slice (AC-H12), and the docs/08 exception becomes a prerequisite. A third pass the same day applied the cross check triage: method notes hold no digits, a local preview for the fact check read (AC-T15), attribute and `forbiddenNames` scanning, a stale grounding always fails the build, `checkHash` covers every printed manifest string, thin pages are deleted and held, and `eligible` uses `count`.

## Summary

You put six Bangkok topic pages (the hub and 5 categories; muay thai and spa are held for thin data) and one stats page into Google while the rest of the site stays behind the gate, then read Search Console at weeks 2, 4, 8 and 12. Each page is built from a committed snapshot file (facts and picks read once from prod, read only), with copy written by the existing content engine. Tours belong to a page by a written rule (Viator tag or title pattern, minus off city, multi day, transfer and flagged tours), never by coordinates and never ranked by ratings.

Every category page shares one template: the H1, a one line rule and "Checked by the Folio team on {date}", a generated intro, a stat strip of 2 or 3 facts that split that page's tours, "How to choose" sections built from per page groups (picks alternate across trip lengths inside each group), "Local notes" written verbatim by the Folio team where a notes file exists, "Good to know" facts with their sources, then the method note, date and disclosure. The hub is a category index on the same template. A page goes live only after the fact check, which covers its copy, notes, Good to know facts, picks and Open Graph image. No page names a person: the author and publisher is the Folio team, or Folio Voyage. Nothing here deploys without Roy's go ahead.

## Structure

Each child is a flat file in this directory, buildable on its own, with a short inline rationale. The cross child contract below is what they share.

- [0006-gate-robots-sitemap.md](0006-gate-robots-sitemap.md): the gate allowlist, robots while gated, and `/sitemap-slice.xml` (scope row 18). Supports the gate and sitemap decisions. Criteria `AC-G`.
- [0006-page-manifest-membership.md](0006-page-manifest-membership.md): the manifest of 9 pages and the tour membership rule, written as data (scope row 19). Supports the membership, ordering and picks decisions. Criteria `AC-M`.
- [0006-prod-snapshot.md](0006-prod-snapshot.md): the read only `seo:snapshot` command and the snapshot files (scope row 20). Supports the snapshot and hash decisions. Criteria `AC-S`.
- [0006-page-template.md](0006-page-template.md): the static route, layout, breadcrumbs, structured data and the leak test (scope row 21). Supports the URL decision. Criteria `AC-T`.
- [0006-pick-card-campaign.md](0006-pick-card-campaign.md): the rating free card and the campaign tagged click out, with the new `AffiliateClick.campaign` column (scope row 22). Supports the campaign record decision. Criteria `AC-C`.
- [0006-hub-copy.md](0006-hub-copy.md): hub copy generation, blocking checks, claim tracing, the fact check, and the batch calibration (scope rows 23 and 24). Supports the copy, model and calibration decisions. Criteria `AC-H`.
- [0006-stats-page.md](0006-stats-page.md): the stats page from fixed templates (scope row 25). Criteria `AC-D`.
- [0006-measurement.md](0006-measurement.md): Search Console, the weekly export, slice analytics, and the checkpoint readouts (scope rows 26 and 27). Criteria `AC-R`.

## Requirements

**User stories**:
- As Roy, I want a small set of Bangkok pages indexed while the rest of the site stays gated, so that I learn whether curated pages with visible logic can rank before I build more.
- As a searcher, I want a page that explains which tours it picked and why, with facts I can check, so that I can choose without reading a wall of listings.
- As Roy, I want every click out to say which page sent it, so that the week 12 readout can tie traffic to bookings intent.
- As Roy, I want no rating, review, price, availability or cancellation claim in the page HTML, so that the pages honour Viator's terms (BRI-204) and F1.

**Acceptance criteria** (the umbrella contract; each child holds its detailed criteria):
- **AC-1**: The manifest at `apps/web/src/content/seo/bangkok/manifest.json` is the one list of slice pages. The gate allowlist, `/sitemap-slice.xml`, robots, `generateStaticParams`, and the campaign check all read the live set derived from it, and none of them holds its own list of slugs.
- **AC-2**: A page is ready when it is not held and (a) its snapshot file exists, (b) its copy file exists, and (c) its `factCheck.checkHash` equals the `checkHash` computed from its current copy, notes, manifest entry and snapshot (see Hashes). Liveness then follows the links between pages: the hub is live when it is ready and every category page it lists (each one with a snapshot and not held) is ready; a category page is live when it is ready and the hub is live; the stats page is live when it is ready and the hub is live. A page that is not live is absent from the allowlist, the sitemap, robots and `generateStaticParams`. So every live page's breadcrumb and links point at live pages. A copy whose `groundingHash` does not match its current snapshot and manifest does not make a page "not ready": it **fails the build** (Live set), for every page that is not held and has both files. The local preview (AC-T15) is the only place a page that is not live renders.
- **AC-3**: Pages render statically at build from committed files only. No slice page, card or route reads the database at build or request time, except `/go/tours/*`, which keeps its existing API call.
- **AC-4**: The visible text and JSON-LD of every live page, as written by `next build`, contain no rating, review count, price, availability or cancellation term (the leak test in `0006-page-template.md`, AC-T6).
- **AC-5**: Nothing in this slice uses tour coordinates.
- **AC-6**: No command in this slice writes to prod. The only prod reads are `seo:snapshot` and `seo:clicks`, both on a connection that reports `default_transaction_read_only = on` before the first query.
- **AC-7**: No personal name appears in any rendered text, attribute, template, JSON-LD or method note of a slice page. Anything signed is signed "Folio team", and the publisher is "Folio Voyage". No rendered wording implies more people than exist (no "our editors", "our experts", "our writers"). `factCheck.by` is an internal record and is never rendered. The leak scan enforces this on the built HTML, attribute values included, against the manifest's `forbiddenNames` (AC-T6).
- **AC-8**: A pull request into `master` fails CI when it would take a currently live slice page out of the live set, unless the manifest at the PR head marks that page `"held": true`. "Currently live" is `LIVE_SLUGS` in `live.generated.ts` on the base branch; the head's set is the same file at the head (the staleness test proves it matches the derivation). So a snapshot refresh that changes picks or facts and the `hub-copy:approve` (and, for a facts change, the `hub-copy:run`) that brings each changed page back land in the same PR. The check is `pnpm --filter @folio/web seo:live-guard --base {base commit}` (Live set, below).
- **AC-9**: Every number printed on a slice page, and every number given to the copy generator, is computed from the **printable pool**: the AC-M2 pool without its BRI-200 gate step (AC-M2a). Counts that pass through the gate are treated as review derived (D6) and are internal: they decide only the floor of 10 eligible members (AC-M6), the rule of 3 eligible members per section (AC-M5) and the picks.

  **Words.** In this spec "members" means printable members (AC-M2a) everywhere. Where the gate applies, the text says "eligible members". `facts.memberCount` is the printed member count; the gated counts are `eligible.count` and `eligible.sections[].count`. They live in the snapshot's `eligible` block, which is not part of `facts`, `factsHash` or the grounding, and which `seo:index` leaves out of `pages.generated.ts`, so the page module cannot read it.

  **Sentinel values in tests.** A test that asserts a number is present in, or absent from, rendered HTML, JSON-LD or the prompt uses distinctive fixture values: 431 printable and 217 eligible members across this spec. A sentinel must not collide with a date part (a day, month or year, including `computedOn` and the checked line), a year, or any number a template prints on its own (section and pick counts, percents, medians). The method notes and the rule line hold no digits at all (AC-T4, AC-T12, AC-D2), so they never collide. A fixture that would make a sentinel collide changes the fixture, not the assertion.

## Decision

**Chosen option**: Option 1: committed snapshot files plus a JSON manifest, rendered by one static route, gated by an allowlist derived from the manifest.

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| URL | `/destinations/bangkok/{slug}` from a static folder `apps/web/src/app/destinations/bangkok/[page]/page.tsx`, `dynamicParams = false` | Prerenders, adds one file, leaves the `[slug]/[city]` redirect untouched (Step 0 showed a merged handler renders per request) | A merged `[slug]/[page]` handler |
| Slugs | `things-to-do` (hub), `floating-markets`, `temples`, `spa-and-massage`, `muay-thai`, `day-trips`, `cooking-classes`, `cruises`, `stats` | Short, match the target query; a test forbids any slug equal to a destination slug | `river-cruises` and longer phrases |
| Manifest home | JSON in `apps/web/src/content/seo/bangkok/manifest.json`, types in `@folio/shared` as type only imports | The edge middleware can import JSON; the CommonJS API reads it with `fs` because it cannot `require` the ESM shared package | A TypeScript constant in `@folio/shared` |
| Live set for the edge | A generated `live.generated.ts` (slugs only) and `pages.generated.ts` (static imports of every file), written by `pnpm --filter @folio/web seo:index` (run automatically by the apps/api commands) and checked by a staleness test | Middleware cannot use `fs` and must stay small | Reading the folder with `fs` at build |
| Membership | Per page: any of its tag ids OR its title pattern, then shared exclusions (including a representative tour whose `affiliateUrl` fails the `/go` host check, AC-M3), then the BRI-200 gate and a published Experience | Tags alone miss most titles (floating markets: 1 tag versus 203 titles); coordinates are missing for 612 tours and cannot exclude off city ones | Coordinates within a radius |
| Sections | Per page groups from the manifest (title patterns, first match wins); a group shows only with at least 3 eligible members, the rest go to the page's "other" group; fewer than 2 sections means one list | Readers choose by their first decision (place, dinner or not), not by rank (research lens 2); title patterns are testable data | Length groups as sections |
| Ordering | Inside a section: round robin across length groups (`under4h`, `4to8h`, `fullDay`, `unknown`); inside a length group, distinct keyword groups covered descending, then `providerTourId` ascending | The prod dry run (16 Oct 2026) showed the old rule filled every page from one length group; raw inclusion count rewards padded lists | Length group, then raw inclusion count (the old rule) |
| Picks | 3 per section (12 in the one list case), floor of 10 eligible members; tours on the manifest image exclusion list are never picked; hub shows 2 from each category page with a snapshot that is not held, taking the next pick when one repeats | Enough to compare, few enough to curate | 20 picks |
| Page blocks | One template for every category page (D1); the hub is a category index on it | One component set, one leak scan surface | A template per page |
| Rule line | No numbers; one clause on the quality bar (D6) | A printed bar or pass count is review data in server HTML | Print the bar |
| Printed counts | From the printable pool (no BRI-200 gate); gated counts stay internal in `eligible` (AC-9) | A count of tours that passed the gate is a count derived from reviews, the same thing D6 keeps out of the rule line | Print gated counts, as the first draft did |
| Keeping pages live | A CI guard against the base branch's live set; a refresh and its approve share one PR (AC-8) | A pick refresh unpublishes a page until approved, so merging one without the other silently drops it from the index | A reminder in the release prompt |
| Local notes | Verbatim `{slug}.notes.json`, signed "Folio team", never seen by the generator (D3) | The only firsthand content, so it stays exactly as written; a documented F1 exception | Notes as generator grounding (BRI-212's idea) |
| Fact check scope | `checkHash` over copy, notes, Good to know facts, picks, the Open Graph image and every other manifest string the page prints | "Checked by the Folio team on {date}" must be true of everything shown | Copy only (`copyHash`) |
| Reading a page before approval | A local only preview, `seo:preview`, that renders any page with a snapshot and a copy file under a "Not approved" banner (AC-T15) | Roy must read the page before `approve`, but only live pages prerender and a page goes live only after `approve` | Approve first, then read the live page |
| Thin page | The snapshot command deletes its file and fails; the page is held in the same PR (AC-S6) | A stale file would keep a thin page listed and block the hub | Leave the old file in place |
| Personal names | A manifest `forbiddenNames` list Roy fills, scanned in text and attributes; an empty list fails validation | Names can arrive from Viator titles or a note; only Roy knows which names to forbid | Rely on the read alone |
| Images | Roy flags bad images in the fact check read; a manifest exclusion list with reasons; Roy picks each page's Open Graph image (D9) | Viator images vary; a person has to look | First pick's image |
| Map | None (D8) | No coordinates in the slice (AC-5) | A static map |
| Snapshot | `seo:snapshot` in apps/api, `doppler run --config prd`, own read only connection, two hashes (`factsHash`, `picksHash`) | Pages never touch live data; copy survives a pick refresh | A build time DB read |
| Copy | Committed `{slug}.copy.json` beside the snapshot, made with the existing `TourCopyGenerator` port through Cloudflare AI Gateway, model `HUB_COPY_MODEL` | Reuses the checked engine; files review in a PR | A `HubCopy` table |
| Campaign record | New nullable `AffiliateClick.campaign`, set from `?p=` checked against the live set; fallback `canvas-tour` | Referrer is unreliable, `sessionId` and `providerId` mean other things | Parse `referrer` |
| Gate | Exact live paths plus `/sitemap-slice.xml`, prefixes `/go/tours/` and `/ingest/` once at least one page is live | Smallest surface that still lets crawlers and click outs through | Prefix `/destinations/bangkok/` |
| Sitemap | Separate `/sitemap-slice.xml`, `lastModified` from each snapshot's `computedOn` | Leaves `sitemap.ts` alone while gated | Switch `sitemap.ts` on the gate |
| Measurement | A local read only CLI over the Search Console API, weekly JSON to `~/folio-logs/seo-slice/` | No new service, no hosted secret | A scheduled job on Railway |
| Build approach | Tracer Bullet: foundations (rows 18 to 20), then the hub end to end (21 to 23), then the other pages (24, 25), then measurement (26, 27) | The scope's order | Build all nine page templates first |

## Cross child contract

### Files

All slice content lives in `apps/web/src/content/seo/bangkok/`:

| File | Written by | Read by |
|---|---|---|
| `manifest.json` | hand, through a PR | everything |
| `{slug}.snapshot.json` | `seo:snapshot` (apps/api) | page, sitemap, copy CLI |
| `{slug}.copy.json` | `hub-copy:run` and `hub-copy:approve` (apps/api) | page, live set |
| `{slug}.notes.json` | hand, through a PR (category pages only; today `floating-markets`, `day-trips`, `temples`) | page, live set, `hub-copy:approve`; never `hub-copy:run` |
| `pages.generated.ts` | `seo:index` (apps/web) | page module, local preview, sitemap (`computedOn` only) |
| `live.generated.ts` | `seo:index` (apps/web) | middleware, `generateStaticParams`, robots, sitemap and the `/go` campaign check |

`pages.generated.ts` holds every page that has files, live or not, so the local preview (AC-T15) can render it. Anything public (`generateStaticParams`, robots, the sitemap, the gate) takes its list of slugs from `LIVE_SLUGS` only, never from the keys of `pages.generated.ts`.

The apps/api commands write into apps/web by resolving the path from the repo root (`path.resolve(__dirname, "../../../../web/src/content/seo/bangkok")` or a `--out` flag). After writing, each of them (`seo:snapshot`, `hub-copy:run`, `hub-copy:approve`) runs `pnpm --filter @folio/web seo:index` as a child process, so the generated files never lag the content files. If that step fails, the command prints the error and the command to run by hand, and exits non zero.

### Manifest schema (`SeoSliceManifest`, type in `packages/shared/src/seo-slice.ts`)

```json
{
  "schemaVersion": 1,
  "city": { "slug": "bangkok", "countrySlug": "thailand", "name": "Bangkok", "destinationRef": "343" },
  "exclusions": {
    "offCityTitlePattern": "\\b(phuket|phi phi|krabi|samui|pattaya|chiang mai|chiang rai|hua hin|koh chang|koh tao|phangan)\\b",
    "excludeTagIds": [11922, 12044, 367651, 367656, 367657],
    "maxDurationMin": 1440,
    "plainWords": "tours whose titles name another Thai destination (Phuket, Phi Phi, Krabi, Samui, Pattaya, Chiang Mai, Chiang Rai, Hua Hin, Koh Chang, Koh Tao or Phangan), multi day tours, airport and hotel transfers, tours longer than a day, listings Viator itself flags as broken or non compliant, and tours with no Viator booking link"
  },
  "forbiddenNames": ["..."],
  "tagNames": { "20226": "Markets", "11922": "Multi day Tours" },
  "keywordGroups": {
    "pickup": { "label": "hotel pickup", "phrases": ["pick up", "pickup", "pick-up", "hotel transfer", "drop off"] },
    "meal": { "label": "a meal", "phrases": ["breakfast", "lunch", "dinner", "meal"] }
  },
  "defaultKeywordGroupIds": ["pickup", "meal", "entryFee", "guide"],
  "places": ["Wat Arun", "Damnoen Saduak", "Taling Chan", "Khlong Lat Mayom"],
  "excludedExperiences": [{ "experienceId": "...", "reason": "image is a logo, not the tour" }],
  "pages": [
    {
      "slug": "floating-markets",
      "kind": "category",
      "targetQuery": "bangkok floating market",
      "h1": "Floating market tours from Bangkok",
      "rule": {
        "tagIds": [20226],
        "titlePattern": "\\bfloating markets?\\b",
        "plainWords": "floating market"
      },
      "groups": [
        { "id": "damnoen-saduak", "label": "Damnoen Saduak", "titlePattern": "\\bdamnoen saduak\\b" },
        { "id": "maeklong", "label": "With the Maeklong railway market", "titlePattern": "\\bmaeklong\\b|\\brailway market\\b" }
      ],
      "otherLabel": "Other floating market tours",
      "excludePlaces": ["Floating Market"],
      "ogImageExperienceId": "...",
      "sourceFacts": [{ "fact": "one line fact", "url": "https://public.example/source", "checked": "2026-10-20" }]
    }
  ]
}
```

- `held` (optional, default false) takes a page out of the snapshot, the hub and the live set without deleting its entry (AC-M7, AC-H12).
- `kind` is `hub`, `category` or `stats`. Exactly one `hub` and one `stats`. Neither has a `rule`. Every page, the hub and stats included, has an `h1`; the stats page has `targetQuery: null`. The hub's cards come from the category pages that have a snapshot and are not held (AC-M7). The stats page's facts cover the printable Bangkok pool (AC-M2a) with no page rule applied (AC-D1).
- `rule.plainWords` is the title pattern said in words, written by hand next to the pattern (for example `"temple, Wat Arun, Wat Pho, Wat Phra Kaew, Wat Saket, Wat Traimit, Grand Palace, Emerald Buddha or Reclining Buddha"`). `exclusions.plainWords` does the same for the exclusions. Both feed the "How this page was made" note (AC-T4) and the copy grounding (AC-H2). A test fails when a rule or the exclusions block lacks them.
- `tagNames` names every tag id the manifest uses, for the "How this page was made" note. A test fails when a used id has no name.
- **No digits in note and rule line inputs.** Manifest validation fails when any string the rule line or a method note prints holds a digit: `rule.plainWords`, `exclusions.plainWords`, the `tagNames` a page uses, group `label`s, `otherLabel`, keyword group `label`s and `places`. So the no digit tests on the notes and the rule line (AC-T4, AC-T12, AC-D2) cannot fail on data Roy writes later.
- `forbiddenNames` lists the personal names that must never appear on a slice page: Roy's own name, any name he chooses, in any spelling he wants caught. Roy fills it; it is not written by the builder. Manifest validation (apps/api AC-S2 and `seo:index`) fails when the list is empty or an entry is blank. The leak scan matches each entry as a whole word or phrase, case insensitive, in visible text, attribute values and JSON-LD (AC-T6). An entry that also matches a `places` entry (for example a name inside "Jim Thompson House") fails validation, so Roy chooses between forbidding the name and listing the place.
- Patterns are JavaScript regular expressions, matched case insensitive against `Tour.title`.
- `sourceFacts` holds 0 to 5 entries per page; an empty list is valid and is the starting state. Each entry is `{ fact, url, checked }`, `checked` being the date (`YYYY-MM-DD`) the source was last read. They render in "Good to know" with their source link and checked date (D4), feed the copy grounding (AC-H2), and are part of `checkHash`. Roy owns them: a new entry lands through his PR, and his fact check (AC-H6) covers it. Fees are described in words, never as amounts: the leak scan has no fee exemption (D7), and a validation test runs the leak list over every `fact`.
- `keywordGroups` defines every keyword group once: an id, a `label` (the words a template prints, for example "hotel pickup") and its `phrases`, matched case insensitive on word boundaries against inclusion text. `defaultKeywordGroupIds` is the set a page uses unless it lists its own `keywordGroupIds`. The groups are listed in `0006-prod-snapshot.md` (AC-S8) and the per page sets in `0006-page-manifest-membership.md` (AC-M1). They drive the stat strip (AC-S4) and the rank inside a length group (AC-M5).
- `places` is the place list (AC-S8). A page's `excludePlaces` drops names that are its own topic from that page's `topPlaces` (D10); the copy check still traces against the full list.
- `groups` (category pages, 0 to 4 entries, in display order) and `otherLabel` define the "How to choose" sections (AC-M5). Group patterns follow the same rules as `rule.titlePattern`. A test fails when a group id repeats on a page or a group lacks a label.
- `excludedExperiences` lists Experiences Roy flagged in a fact check read, each with a `reason` (D9). They stay members (facts still count them) but are never picked on any page or the hub. The reason is internal and is never rendered.
- `ogImageExperienceId` is the Experience whose pick image is the page's Open Graph image, chosen by Roy (D9). On a category page or the hub it must be one of that page's picks; on the stats page, a pick on any category page that has a snapshot. `hub-copy:approve` refuses when it is missing or not found (AC-H6), so every live page has one.
- Adding a page later is a manifest PR plus a snapshot run. No code change (the control pages, brief section 8, question 7).

### Snapshot schema (`SeoSliceSnapshot`)

```json
{
  "schemaVersion": 1,
  "slug": "floating-markets",
  "computedOn": "2026-10-20",
  "facts": { "memberCount": 160, "bandCounts": {}, "inclusionShares": {}, "topPlaces": [], "sections": [], "strip": [] },
  "factsHash": "v1:<sha256>",
  "eligible": { "count": 78, "sections": [{ "id": "damnoen-saduak", "count": 19 }] },
  "picks": [{ "experienceId": "...", "providerTourId": "...", "title": "...", "imageUrl": "...", "imageAlt": "...", "durationBand": "4to8h", "section": "damnoen-saduak", "inclusions": ["...", "...", "..."] }],
  "picksHash": "v1:<sha256>"
}
```

(Numbers illustrative.) `facts` holds printable counts only (AC-9). `eligible` holds the internal counts through the BRI-200 gate: `count`, the number of eligible members (the floor, AC-M6), and, per section the page shows, `{ id, count }` (the rule of 3 eligible members, AC-M5; `[]` for one list). The `count` key is deliberately not `memberCount`, so the printed count and the gated count never share a name. The hub and stats snapshots have `"eligible": null`. `eligible` is never rendered, never in the grounding, and never in `pages.generated.ts`.

`picks` are in render order. `section` is the group id, `"other"`, or null when the page shows one list (AC-M5). On the hub, each pick holds `fromSlug`, the category page it came from (AC-M7), and `section` is null. The stats snapshot has `picks: []`.

### Notes file schema (`SeoSliceNotes`)

```json
{
  "schemaVersion": 1,
  "slug": "floating-markets",
  "notes": [
    { "id": "fm-early-start", "kind": "timing", "basis": "firsthand", "written": "2026-10-20", "text": "One to three plain sentences." }
  ]
}
```

- A notes file is optional and belongs to a category page only. Notes are firsthand but written without the first person: the same `firstPerson` check as generated copy (AC-H3: no `I`, `I'm`, `I've`, `me`, `my`, `we`, `we're`, `we've`, `us`, `our`, `ours`, and no `SEO_SLICE_TEAM_TERMS` phrase) runs on `text`, so a note never implies who on the team wrote it. `seo:index` fails (exit non zero, nothing written) on a notes file for a hub, stats, held or unknown slug.
- `kind` is one of `timing`, `how-to`, `opinion`, `warning`. `basis` is `firsthand`, the only value allowed. `written` is a date. `text` is 1 to 400 characters. `id` is unique in the file.
- A note never names a tour or an operator, and never speaks of price, availability, cancellation or ratings. Three checks run at `seo:index` and at `hub-copy:approve`: the leak list (AC-T6) over `text`, the `firstPerson` check above, and a name check that fails when `text` contains the `providerTourId` or the full title (case insensitive) of any pick in any snapshot file. That catches a pasted tour, not a paraphrased one or an operator name (operators are not in the data), so Roy's read covers the rest.
- Notes are rendered verbatim, never paraphrased, never passed to the model, and are not part of `groundingHash`. They are part of `checkHash`, so editing a note takes the page offline until it is approved again.
- The rendering signs each note "Folio team" with its `written` date. This is a documented exception to F1 (rationale.md).

The exact `facts` keys per page kind are in `0006-prod-snapshot.md` (AC-S4) and `0006-stats-page.md` (AC-D1).

### Copy file schema (`SeoSliceCopy`)

```json
{
  "schemaVersion": 1,
  "slug": "floating-markets",
  "intro": "120 to 220 words",
  "seoTitle": "at most 60 characters",
  "metaDescription": "at most 155 characters",
  "groundingHash": "v1:<sha256>",
  "model": "claude-sonnet-5",
  "promptVersion": "hub-v1",
  "attempts": 1,
  "generatedAt": "2026-10-20T10:00:00Z",
  "factCheck": { "by": "{initials}", "at": "2026-10-21T09:00:00Z", "checkHash": "v1:<sha256>" }
}
```

The stats page copy file has no `intro`. `factCheck` is absent until `hub-copy:approve` writes it. `factCheck.at`, shown as a date in `Asia/Bangkok`, is the date in "Checked by the Folio team on {date}". `factCheck.by` is never rendered (AC-7).

### Hashes

One recipe, implemented twice (once in apps/api, once in apps/web) and pinned by the same golden vector test in both apps:

- `canonicalHash(value)` = `"v1:" + sha256(JSON with keys sorted at every level, no whitespace)`, hex.
- `factsHash` = `canonicalHash(facts)`. `picksHash` = `canonicalHash(picks)`. Neither includes `computedOn` or `eligible`.
- `groundingHash` = `canonicalHash({ factsHash, h1, targetQuery, rulePlainWords, exclusionsPlainWords, sourceFacts })`, all taken from the page's manifest entry (`rulePlainWords` is null for the hub and stats; `sourceFacts` in manifest order). So any manifest edit that changes what the copy was written from also makes the copy stale.
- `checkHash` = `canonicalHash({ intro, seoTitle, metaDescription, notes, sourceFacts, picksHash, ogImageExperienceId, ogImageUrl, rendered })`. `intro` is omitted for stats; `notes` is the notes file's `notes` array, or `[]` when there is no file; `sourceFacts` and `ogImageExperienceId` come from the manifest page; `picksHash` from the snapshot (the stats page uses `null`); `ogImageUrl` is the `imageUrl` of the pick `ogImageExperienceId` names (AC-T5), or null when no current snapshot holds that pick. `rendered` is every manifest string the page prints that is not already in the grounding (`groundingHash` covers `h1`, `rule.plainWords` and `exclusions.plainWords`, and a mismatch there fails the build):
  - on every page: the hub's `h1` (the breadcrumb, AC-T8);
  - on a category page: the `tagNames` entries for its tag ids, and the `label` of each keyword group in its set (the note, AC-T4);
  - on the hub: the `slug` and `h1` of each category page it lists (the section headings and links, AC-T3);
  - on the stats page: the `slug` and `h1` of each category page in `durationByCategory`, the `label` of each default keyword group, and `places` (AC-D2).

  It replaces the earlier `copyHash`. So an edit to copy, a note, a Good to know fact or any printed manifest string, a new Open Graph choice, or a snapshot refresh that swaps picks or the stats page's Open Graph pick, each takes the page offline until Roy approves it again. A test in apps/web changes each manifest string in turn and fails when a page's HTML changes while both its `groundingHash` and its `checkHash` stay the same, so a printed string left out of `rendered` is caught. A pick only refresh still keeps the copy (the grounding is unchanged), so it needs an approve, not a regeneration.

### Live set

`seo:index` reads every file, computes AC-2 for each manifest page, and writes `LIVE_SLUGS` (a literal array in manifest order) to `live.generated.ts`, plus the typed data to `pages.generated.ts`. At build, the page module recomputes `factsHash` and `groundingHash` (Node runtime) for every page that is not held and has a snapshot and a copy file, live or not, and **fails the build** when a snapshot's facts do not match its `factsHash` or a copy's `groundingHash` does not match. That is the only consequence of a stale grounding: it never quietly drops a page from the live set (AC-2). A missing or stale `factCheck` is not a build failure; the page is simply not live. `seo:index` also validates every notes file (schema, leak list, name check) and every `sourceFacts` entry (leak list, `checked` is a date, `url` is `https`), and fails with nothing written when one is invalid; `seo:index` computes `checkHash` for AC-2 (c) from the same inputs `hub-copy:approve` uses. An empty `LIVE_SLUGS` is valid: the build passes with no slice pages, the sitemap has an empty `<urlset>`, and the gate passes neither `/go/tours/` nor `/ingest/` (a test covers this, since it is the state before the first approval); the first live slug opens both prefixes. A jest test in apps/web reruns the derivation and fails if either generated file differs from what is on disk. `pages.generated.ts` carries each snapshot without its `eligible` block (AC-9); a test asserts no generated page object has the key. `seo:index` does not fail on a stale grounding (it runs right after `seo:snapshot`, before the copy is regenerated); it prints each page whose `groundingHash` no longer matches and the `hub-copy:run` command that fixes it, so you see what would fail the build before CI does.

**Live guard (AC-8).** `seo:live-guard --base {ref}` reads the `LIVE_SLUGS` literal from `git show {ref}:apps/web/src/content/seo/bangkok/live.generated.ts` and from the working tree. For each slug live at the base but not at the head, it passes only when the head manifest has that page with `"held": true`; a slug removed from the manifest outright fails. It passes when the base has no such file (before the first slice PR). It exits non zero with one line per dropped slug, naming the likely cause from AC-2 (no snapshot, no copy, `checkHash` stale, or the hub dropped because a page it lists is not ready). A stale grounding is not a cause here, because it fails the build before the guard matters. CI runs it in the `lint-typecheck-test` job on pull requests only, with `--base ${{ github.event.pull_request.base.sha }}`; that job's checkout already uses `fetch-depth: 0` for Turbo's `--affected`, so the base commit is present. Holding a category page changes the hub's facts, so holding one also needs the hub regenerated and approved in the same PR, or the guard fails on the hub.

### Campaign format

`seo-bangkok-<slug>`, where `<slug>` is in `LIVE_SLUGS`. Used on the Viator URL (`withCampaign`), in `AffiliateClick.campaign`, and as the PostHog `source` on the card's click event. Anything else falls back to `canvas-tour` (AC-C3).

### Representative tour

One card per Experience. Its tour is the lowest `id` non deleted Tour of that Experience, the same tour `GET /v1/experiences/:id` and `/go/tours/:experienceId` use (spec 0005). Every rule is applied to that tour: an Experience is a member (printable) only when its representative tour is in the printable pool and passes the page rule (AC-M2a, AC-M4), and an eligible member only when that same tour also passes the BRI-200 gate (AC-M2). Picks come from eligible members, so the card and the click out always describe the same tour.

## Build plan

Tracer Bullet. Each step names the child criteria it satisfies.

1. Shared types and the hash recipe with its golden vector test in both apps, satisfies **AC-1**, AC-S3.
2. Manifest file with all 9 pages, rules, exclusions, keyword groups, places and per page groups (`muay-thai` and `spa-and-massage` held); the pure membership, section and pick functions and their tests in apps/api, satisfies AC-M1 to AC-M10.
3. `seo:snapshot` with the read only guard, writing the 7 snapshot files for the pages not held, printable `facts` and internal `eligible`, satisfies **AC-6**, **AC-9**, AC-S1 to AC-S9.
4. `seo:index` and the two generated files, with notes and source fact validation and `checkHash`, plus the staleness test, and `seo:live-guard` with its CI step, satisfies **AC-2**, **AC-8**.
5. Gate allowlist, gated robots, `/sitemap-slice.xml`, satisfies AC-G1 to AC-G7.
6. The static route and the shared template (every block of AC-T3, the hub as a category index), proven on `things-to-do`, with the leak and name scan and the local preview, satisfies **AC-3**, **AC-4**, **AC-7**, AC-T1 to AC-T15.
7. `AffiliateClick.campaign` migration, controller field, `?p=` handling in `tour-go.ts`, and the card, satisfies AC-C1 to AC-C7.
8. **Prerequisite:** the docs/08 scoped exception PR (Consequences) is merged first. Hub copy: prompt, checks, claim trace, `hub-copy:run` and `hub-copy:approve` (with `checkHash`, notes and Open Graph checks), proven on `things-to-do`, satisfies AC-H1 to AC-H9.
9. Roy writes the notes files for `floating-markets`, `day-trips` and `temples`; generate the 5 category pages that are not held and run the batch calibration; Roy's fact check read covers copy, notes, Good to know, images and the Open Graph choice, satisfies AC-H6, AC-H10 to AC-H13.
10. Stats page facts and templates, and its copy (held if it fails), satisfies AC-D1 to AC-D6.
11. Slice analytics settings, the Search Console CLI, `seo:clicks` with its stale pick list, and the readout template, satisfies **AC-6**, AC-R1 to AC-R8, AC-R10.
12. Run the checkpoint readouts at weeks 2, 4, 8 and 12, satisfies AC-R9.

**AC-5** is held by the membership tests (step 2) and by the absence of any coordinate field in the snapshot schema.

## Consequences

**Positive**:
- Pages are plain static files. A bad deploy cannot leak live ratings or prices, and every claim on a page sits in a committed file a reviewer can read.
- Copy is tied to facts, not picks, so a refresh that only swaps tours keeps the generated copy (it still needs an approve, below).
- Adding a page, a group, a keyword set or a source fact is a manifest PR, with no code change.
- Picks spread across a page's groups and trip lengths. On prod (16 Oct 2026) the old rule filled every live page from a single length group; the new rule cannot.
- "Checked by the Folio team on {date}" is true by construction: it shows only while `checkHash` matches what Roy approved.

**Negative / tradeoffs**:
- Two copies of the hash recipe (api and web), kept equal only by the golden vector test.
- The generated files must match the content files. The apps/api commands rerun `seo:index` themselves; a hand edit to a content file still needs a manual `seo:index`, and forgetting it fails the staleness test in CI, not at runtime.
- A facts change fails the build until the copy is regenerated (a stale `groundingHash` is a build failure, not a quiet drop from the live set, AC-2), and the page is not live until it is fact checked again. That is deliberate, but it makes a refresh a two step PR.
- A page that falls under the floor costs a PR of its own work: the snapshot command deletes its file and fails, and the page is held and the hub regenerated and approved in the same PR (AC-S6).
- The local preview (AC-T15) is a second way to render a page. It is kept to `next dev` on your machine, and a test proves a production build never takes that path.
- Any refresh that swaps picks, and any edit to a note or a Good to know fact, takes the page offline until Roy runs `hub-copy:approve` again. Each refresh costs one approve per changed page.
- Two documented exceptions to F1 and to docs/08's "no approval step" and "fact checked" wording now exist: the per page fact check, and verbatim Local notes (rationale.md). docs/08 is not edited in this change, but a small docs PR that adds a scoped exception for slice pages (the "Checked by the Folio team" line, the approval step and signed Local notes) is a **prerequisite** for build step 8 and scope row 23, and is on the scope's "Before launch" list. No code reads or hashes docs/08 (rationale.md), so that PR changes no test result; it should append the exception rather than insert lines above line 27, because code comments cite docs/08 by line number.
- Printed counts are larger than the number of tours a page can show, because they include tours below the quality bar (AC-9). The stat strip and the hub's one line facts say so in a fixed caption.
- Every slice PR that refreshes a snapshot also carries the approvals that keep its pages live (AC-8), so a refresh cannot merge until Roy has done the fact check read.
- Cooking classes and cruises are expected to be weak (operator sites and OTA results pages hold those results). They stay in the slice but are not the quality signal; floating markets, temples and day trips are.
- **Two approved pages are held from the start.** On prod (15 Oct 2026) `muay-thai` has 6 eligible members and `spa-and-massage` has 3, because most of their tours have fewer than 5 reviews and the BRI-200 gate drops them. Roy chose to hold both (`"held": true` in the manifest, decided 15 Oct 2026). The slice runs with 7 URLs: the hub, 5 category pages and stats. The spa caveat recorded in the scope no longer applies.
- A title pattern exclusion also drops a real Bangkok tour whose title merely names an excluded place (for example a Bangkok tour ending in Pattaya). That is accepted: the rule errs toward leaving tours out.

**Neutral**:
- One additive migration (`AffiliateClick.campaign`), shipped through the pre deploy migration path.
- New env vars: `HUB_COPY_MODEL` (validated in `apps/api/src/config/env.validation.ts`), `GSC_SERVICE_ACCOUNT_JSON`, `GSC_SITE_URL`, `SEO_SLICE_SITE_LINKS`.
- Anyone can put `?p=` on a `/go` link, and bots will follow `/go` links. Only live slugs are ever written, so the column stays a closed list, but its counts include some noise. `seo:clicks` reports clicks with a bot user agent separately (AC-R4) rather than trying to block them.
- The calibration batch is the 6 topic pages that are not held (hub plus 5 categories), with the same bar of 2 failures (AC-H10).

## Follow-up

- [ ] Recheck the two held pages when the review counts grow: unhold one by removing `held` once a snapshot run shows it has at least 10 eligible members.
- [ ] Fill `forbiddenNames` in the manifest: a task for Roy, before build step 2 can pass validation.
- [ ] Check tag 20238 (Private Drivers, 297 Bangkok tours) in the first snapshot report. It is not excluded today; if private driver listings crowd the day trips page, add it to `excludeTagIds` through a manifest PR.
- [ ] Consent flow (brief section 8, question 9): a launch prerequisite with its own task. Blocks the public launch, not the gated crawl test.
- [ ] Search Console DNS TXT verification for `foliovoyage.com` (brief section 8, question 10): a task for Roy, blocks AC-R1.
- [ ] BRI-246 (Backlog): `doppler run -- pnpm dev` does not work through Turbo today. The slice does not depend on it: the preview runs `next dev` in apps/web directly (AC-T15).
- [ ] Service account key for Search Console in Doppler `dev` as `GSC_SERVICE_ACCOUNT_JSON`: a task for Roy, blocks AC-R3.
- [ ] Submit `/sitemap-slice.xml` in the Search Console UI after the first deploy Roy approves: a task for Roy. Its date is week 0 for every readout (AC-R8).
- [ ] Write the first `sourceFacts` for any page Roy wants them on: a task for Roy, optional, through a manifest PR.
- [ ] Write the notes files for `floating-markets`, `day-trips` and `temples` (firsthand only, D3): a task for Roy, before step 9.
- [ ] BRI-212 (structured local knowledge input) is still undesigned in the repo. The slice's notes file is verbatim and never grounding; if BRI-212 later feeds notes to generation, it needs its own spec and must not reuse this file as grounding.
- [ ] The research's "people also ask" questions were not harvested. If Good to know needs more facts, harvest them first.
- [ ] CI does not run `next build` today. The leak scan (AC-T6) adds that step, so check during the build that `pnpm --filter @folio/web build` passes in CI without Doppler secrets. If it does not, say so in the PR. The scan then runs as a required local step before every slice PR merges until CI can build.
- [ ] Control pages research PR: adds pages to the manifest later with no code change.
- [ ] Remove the transitional manual `migrate:deploy` step from the release prompt once the `campaign` migration is confirmed applied by the pre deploy step.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
