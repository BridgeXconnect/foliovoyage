# 0006. Snapshot files from prod, read only (child of 0006 SEO proving slice)

Scope row 20. Governed by [index.md](index.md): the snapshot schema, hashes and file locations live there.

## Summary

`seo:snapshot` reads Bangkok tours from prod on its own read only connection, runs the membership rule, and writes one committed JSON file per page with its facts, its picks, the date and two hashes. You run it by hand whenever you want a refresh. A rerun on unchanged data leaves the files exactly as they were, and a page that is too thin gets no file (its old one is deleted, and the page must be held in the same PR). (Amended 16 Oct 2026: facts now include the page's sections and its stat strip; keyword groups and places come from the manifest; notes files are never read or written here. Every count in `facts` comes from the page's printable members, which skip the BRI-200 gate; gated counts go to a separate internal `eligible` block, index.md AC-9.)

## Requirements

**User stories**:
- As Roy, I want a command that refreshes the slice's data from prod without any chance of writing to it, so that pages show real tours safely.
- As a reviewer, I want each refresh to land as a readable diff in a PR, so that I can see what changed on each page.

**Acceptance criteria**:
- **AC-S1**: `doppler run --config prd -- pnpm --filter @folio/api seo:snapshot` runs `apps/api/src/modules/content/seo-snapshot.cli.ts` through `ts-node`. It opens one `pg` `Client` (not a pool) from `DIRECT_URL`, the unpooled Neon host, because the pooler may drop startup options. On that same client it runs `SET default_transaction_read_only = on`, then `SHOW default_transaction_read_only`, and exits non zero with no data query run when the answer is not `on`. Every later query runs on that same client.
- **AC-S2**: The command reads the manifest with `fs` and validates it with a Zod schema in apps/api (mirroring the shared type). An invalid manifest exits non zero and writes nothing. Invalid includes the rules index.md sets on manifest values: an empty `forbiddenNames` or a blank entry in it, a digit in any string the rule line or a method note prints (the full list is in index.md, Manifest), and an `excludedExperiences` entry without a `reason`.
- **AC-S3**: It loads every non deleted Tour with the manifest's `destinationRef`, joined to its Experience, in one query, then calls `selectMembers` (AC-M8), which returns each page's printable and eligible members (AC-M2a). Hashes follow the recipe in index.md, and a golden vector test pins them.
- **AC-S4**: Every count in `facts` is computed over members, which always means printable members (AC-M2a, index.md AC-9, Words). Category page `facts`:
  - `memberCount`;
  - `bandCounts`, members per length group (AC-M5);
  - `inclusionShares`, one `{ count, of }` per keyword group in the page's `keywordGroupIds` (else `defaultKeywordGroupIds`), where `of` is `memberCount` and `count` is members with at least one inclusion whose text matches that group (AC-S8); an inclusion's text is its `description`, else its `typeDescription`, else it is skipped;
  - `topPlaces`, up to 5 `{ name, count }` from the manifest `places` minus the page's `excludePlaces`, by title count descending, then name ascending, counting only places with a count of at least 2;
  - `sections`, one `{ id, label, memberCount }` per section the page shows (which sections exist is decided on eligible members, AC-M5), in order, `other` included with `otherLabel`, `memberCount` being the printable section count (AC-M5); `[]` when the page shows one list;
  - `strip`, the stat strip (below).

  Hub `facts`: `memberCount` over the union of the printable members of the category pages that have a snapshot and are not held (which pages those are is decided on eligible members, AC-M6); `bandCounts` and `inclusionShares` over that union, using `defaultKeywordGroupIds`; `pages`, one `{ slug, memberCount, mainLength }` per such page in manifest order, where `mainLength` is the known length group (`under4h`, `4to8h` or `fullDay`) with the most members, ties in that order, or null when none has members; and `strip` over the union. Stats `facts`: AC-D1.

  **The stat strip (D1).** Candidates are the page's keyword groups (from `inclusionShares`) and the three known length groups (from `bandCounts`; `unknown` is never a candidate). A candidate qualifies when `count` is 0, or when `count / of` is between 0.2 and 0.8 inclusive. Qualifying candidates with a count above 0 come first, ordered by how close `count / of` is to 0.5, ties by keyword groups in `keywordGroupIds` order, then length groups in length order; count 0 candidates come after, in the same tie order. Take the first 3. When fewer than 2 qualify, `strip` is `[]` and the page shows no strip. Each entry is `{ kind, key, label, count, of }`: `kind` is `keyword` or `length`; `label` is the keyword group's `label`, or `under 4 hours`, `4 to 8 hours` or `a full day`. The words around each entry are a template (AC-T13).
- **AC-S4a**: Each category snapshot also holds `eligible`: `{ count, sections: [{ id, count }] }`, the number of eligible members (the floor, AC-M6) and the number of eligible members in each section the page shows (the rule of 3 eligible members, AC-M5), `[]` for one list. The hub and stats hold `"eligible": null`. `eligible` is not part of `facts`, `factsHash` or the grounding, and is never rendered (index.md AC-9).
- **AC-S5**: Picks follow AC-M6 and AC-M7, in render order. Each pick holds `experienceId`, `providerTourId`, `title`, `imageUrl`, `imageAlt` (the tour's `imageAlt`, else its title; the title is also used when `imageAlt` holds a leak term from AC-T6, since the leak scan reads `alt` attributes), `durationBand`, `section` (index.md), and `inclusions` (the first 3 inclusion texts, each the item's `description`, else its `typeDescription`, skipping any text with a leak term from AC-T6, trimmed, at most 120 characters). No pick field holds a rating, review count, price, coordinate, or affiliate URL.
- **AC-S6**: A page marked `"held": true` in the manifest is skipped, and its files are left as they are. A category page that is not held and has fewer than 10 eligible members is thin: the command writes no snapshot for it, **deletes** its existing snapshot file if there is one, writes the other pages, and exits non zero, printing for each thin page that you must set `"held": true` on it in the manifest, then regenerate (`hub-copy:run`) and approve the hub, all in the same PR as this refresh. A deleted snapshot means the page is not ready, so a thin page that was live drops out of the live set, and the live guard (index.md AC-8) fails the PR until the manifest marks it held. The hub and stats are computed after the category pages, from the category pages that passed, so the hub never waits on a thin page.
- **AC-S7**: When a page's `factsHash` and `picksHash` both equal the hashes in its existing file and its `eligible` block is unchanged, the file is left untouched (its `computedOn` stays). A change to `eligible` alone rewrites the file with its existing `computedOn` kept, and is reported as `eligible changed`; it needs no copy or approve step, since nothing rendered or hashed for the fact check depends on it, and keeping the date keeps the sitemap's `lastmod` honest. Otherwise (a hash changed) the file is rewritten with `computedOn` set to today's date in `Asia/Bangkok`. The command prints, per page, `unchanged`, `facts changed`, `picks changed`, `eligible changed`, or `thin`, then runs `seo:index` (index.md, Files) and, for each page whose facts changed, tells you to run `hub-copy:run` for it; for each page whose picks changed only, it tells you to look at the new cards and run `hub-copy:approve` (the picks are part of `checkHash`, index.md). It ends by reminding you that the refresh, the regenerated copy and every approve go in one PR; CI's live guard fails the PR otherwise (index.md AC-8).
  - **Exclusion counts.** Before that summary, the command prints, for each category page (held pages included), how many tours each shared exclusion (AC-M3) removed: `off city` (`offCityTitlePattern`), `multi day` (tag 11922 or `durationMin` over `maxDurationMin`), `transfers` (tag 12044), `flagged` (tags 367651, 367656, 367657), `leak term` (a leak list term in the title) and `non Viator link` (`isViatorHost` fails). A tour counts on a page when it is a representative tour of a published Experience under ref `343` with an image, and matches that page's rule (AC-M4), before the BRI-200 gate; a tour hit by several exclusions counts once, under the first in that order. One more line gives the same counts for the whole pool, for the hub and stats. These counts are CLI output only: they are never written to a snapshot, a generated file or any rendered page, and they are not hashed.
- **AC-S8**: The keyword groups and the place list are data in the manifest (`keywordGroups`, `defaultKeywordGroupIds`, `places`; index.md), not constants (D10). Phrases are matched case insensitive on word boundaries against inclusion text; places against titles. The manifest holds:

  | Group id | Label | Phrases |
  |---|---|---|
  | `pickup` | hotel pickup | `pick up`, `pickup`, `pick-up`, `hotel transfer`, `drop off` |
  | `meal` | a meal | `breakfast`, `lunch`, `dinner`, `meal` |
  | `entryFee` | entry fees | `entrance fee`, `entry fee`, `admission`, `entrance ticket`, `entry ticket` |
  | `guide` | a guide | `guide` |
  | `marketVisit` | a market visit | `market`, `markets` |
  | `recipe` | recipes to take home | `recipe`, `recipes`, `recipe book` |
  | `vegetarian` | a vegetarian option | `vegetarian`, `vegan` |
  | `buffet` | a buffet | `buffet` |
  | `liveMusic` | live music | `live music`, `live band` |
  | `welcomeDrink` | a welcome drink | `welcome drink` |

  `defaultKeywordGroupIds` is `pickup`, `meal`, `entryFee`, `guide`. Per page sets are in AC-M1 (cooking and cruises have their own).

  Places: Wat Arun, Wat Pho, Grand Palace, Wat Phra Kaew, Damnoen Saduak, Amphawa, Maeklong Railway Market, Ayutthaya, Chao Phraya, Chinatown, Khao San Road, Lumpini, Jim Thompson House, Kanchanaburi, Erawan, Floating Market, Taling Chan, Khlong Lat Mayom. A page drops its own topic through `excludePlaces` (today only `floating-markets` drops Floating Market).
- **AC-S9**: Two reruns on the same data produce byte identical files (keys sorted, arrays in rule order, two space indent, trailing newline).

## Decision

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Where | apps/api content module, beside the tour copy CLIs | Reuses the Prisma types and the membership code | A script in apps/web |
| Connection | One `pg` client (already a dependency) on `DIRECT_URL`, `SET` then `SHOW` before any data query | One connection you can inspect, so the guard is provable; no pooler or Prisma pool to reason about | `PrismaClient` with the option in the URL |
| Refresh | Manual, whenever wanted; date shown on each page | You choose when a diff is worth a PR | Frozen for the test |
| Unchanged rerun | Leave the file untouched | A new date with no data change would mislead the sitemap | Always rewrite |
| Thin page | Delete its file, exit non zero, hold it in the same PR | An old file would keep the page listed on the hub and block the hub from going live | Leave the old file in place (the first draft) |

## Feature design

**API surface**: none. A CLI only, script `"seo:snapshot": "ts-node src/modules/content/seo-snapshot.cli.ts"`, optional `--out <dir>` (default: `apps/web/src/content/seo/bangkok/` from the repo root).

**Value sourcing**:
| Value | Source |
|---|---|
| `computedOn` | today in `Asia/Bangkok`, only when `factsHash` or `picksHash` changed; kept on an `eligible` only change |
| `facts.*` | derived from printable members (AC-S4) |
| `eligible.*` | derived from eligible members (AC-S4a) |
| pick fields | the representative Tour's columns (AC-S5) |
| hashes | `canonicalHash` (index.md) |

**Security model**: prod is read only by construction (AC-S1). The command never logs `DATABASE_URL`.

**Critical test scenarios**:
- The guard refuses a connection that reports `off`, verifies **AC-S1**.
- A rerun on fixture data leaves files untouched, verifies **AC-S7**, **AC-S9**.
- A page with 9 eligible members writes no file, deletes its existing file, and the run exits non zero naming the page and the hold step; a held page's existing file is left untouched, verifies **AC-S6**.
- An inclusion "Free cancellation" is skipped for the next one, verifies **AC-S5**.
- The strip on a fixture page: guide at 90% is dropped, pickup at 56% comes before a full day at 33%, a length group with 0 members comes last, and a page where only 1 candidate qualifies gets `strip: []`, verifies **AC-S4**.
- A fixture page with 431 printable and 217 eligible members writes `facts.memberCount: 431` and `eligible.count: 217`; its `bandCounts`, shares, section counts and strip are over the 431; a page with 40 printable but 9 eligible members is thin, verifies **AC-S4**, **AC-S4a**, **AC-S6**.
- A fixture with one tour per exclusion on a page, plus one tour that is both off city and multi day, prints 1 for each exclusion and counts the double one under `off city` only; no snapshot or generated file contains the counts or the exclusion names, verifies **AC-S7**.
- A rerun where only gated counts move rewrites the file with `eligible changed` and keeps `factsHash`, `picksHash` and `computedOn`, verifies **AC-S7**.
- An `imageAlt` holding "highly rated" is replaced by the title, verifies **AC-S5**.
- `floating-markets` `topPlaces` never lists Floating Market; Taling Chan counts when 2 titles name it, verifies **AC-S4**, **AC-S8**.

## Build plan

1. Facts builder over printable members (sections, strip, per page keyword sets and places from the manifest) and the `eligible` block, with tests, satisfies **AC-S4**, **AC-S4a**, **AC-S8**.
2. The CLI with the guard, manifest validation, writer and printed report (status per page, exclusion counts, next steps), satisfies **AC-S1**, **AC-S2**, **AC-S3**, **AC-S5**, **AC-S6**, **AC-S7**, **AC-S9**.
   - [ ] For `factsHash` and `picksHash`, add the same pinned assertions against the shared fixture in apps/api (`packages/shared/fixtures/seo-slice-golden.json`, as pinned in `apps/web/src/lib/seo-slice/golden.spec.ts`).
   - [ ] `seo:snapshot` under ts-node needs the moduleTypes cjs override that apps/web/scripts/tsconfig.seo.json uses. Checked 16 Oct 2026 from apps/api: plain ts-node fails to load seo-slice-membership with ERR_REQUIRE_ESM; with the override it loads and isViatorHost works, so give the script that override.
3. Run it once against prod (read only) and commit the files, satisfies the scope row's done when.
   - [ ] After that run, write a one-off membership review to ~/folio-logs/seo-slice/membership-review-{date}.md, outside the repo, with the items from the row 19 verify note: tag-only members per page (tags 20226, 21518, 11889 first); size of each page's other group and which groups fold; titles naming Ko Chang, Koh Samet, Khao Yai, Chiangmai, Siem Reap or Angkor; titles each off city word excludes; title only, tag only and both counts per page; how many real titles the leak term exclusion drops; whether any live page draws all its picks from one trip length.

## Rationale (short)

Static files keep pages honest: the reviewer sees every number before it ships, and no request path can leak a live rating. Keeping the date when nothing changed means `lastModified` in the sitemap tells Google the truth.
