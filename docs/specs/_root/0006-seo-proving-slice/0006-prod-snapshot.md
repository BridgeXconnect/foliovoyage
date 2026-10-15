# 0006. Snapshot files from prod, read only (child of 0006 SEO proving slice)

Scope row 20. Governed by [index.md](index.md): the snapshot schema, hashes and file locations live there.

## Summary

`seo:snapshot` reads Bangkok tours from prod on its own read only connection, runs the membership rule, and writes one committed JSON file per page with its facts, its picks, the date and two hashes. You run it by hand whenever you want a refresh. A rerun on unchanged data leaves the files exactly as they were, and a page that is too thin gets no file.

## Requirements

**User stories**:
- As Roy, I want a command that refreshes the slice's data from prod without any chance of writing to it, so that pages show real tours safely.
- As a reviewer, I want each refresh to land as a readable diff in a PR, so that I can see what changed on each page.

**Acceptance criteria**:
- **AC-S1**: `doppler run --config prd -- pnpm --filter @folio/api seo:snapshot` runs `apps/api/src/modules/content/seo-snapshot.cli.ts` through `ts-node`. It opens one `pg` `Client` (not a pool) from `DIRECT_URL`, the unpooled Neon host, because the pooler may drop startup options. On that same client it runs `SET default_transaction_read_only = on`, then `SHOW default_transaction_read_only`, and exits non zero with no data query run when the answer is not `on`. Every later query runs on that same client.
- **AC-S2**: The command reads the manifest with `fs` and validates it with a Zod schema in apps/api (mirroring the shared type). An invalid manifest exits non zero and writes nothing.
- **AC-S3**: It loads every non deleted Tour with the manifest's `destinationRef`, joined to its Experience, in one query, then calls `selectMembers` (AC-M8). Hashes follow the recipe in index.md, and a golden vector test pins them.
- **AC-S4**: Category page `facts`: `memberCount`; `bandCounts` (members per duration band, AC-M5); `inclusionShares`, each of `pickup`, `meal`, `entryFee`, `guide` as `{ count, of }` where `of` is `memberCount` and `count` is members with at least one inclusion whose text matches that keyword group (AC-S8), where an inclusion's text is its `description`, else its `typeDescription`, else it is skipped; `topPlaces`, up to 5 `{ name, count }` from the fixed place list (AC-S8) by title count descending, then name ascending, counting only places with a count of at least 2. Hub `facts`: `memberCount` over the union of members of the category pages that have a snapshot, and `pages`, a list of `{ slug, memberCount }` for each of those pages. Stats `facts`: AC-D1.
- **AC-S5**: Each pick holds `experienceId`, `providerTourId`, `title`, `imageUrl`, `imageAlt` (the tour's `imageAlt`, else its title), `durationBand`, and `inclusions` (the first 3 inclusion texts, each the item's `description`, else its `typeDescription`, skipping any text with a leak term from AC-T6, trimmed, at most 120 characters). No pick field holds a rating, review count, price, coordinate, or affiliate URL.
- **AC-S6**: A page marked `"held": true` in the manifest is skipped. A category page with fewer than 10 members gets no file written; an existing file for it is left in place but the command prints that it is now thin and exits non zero after writing the others. The hub and stats are computed after the category pages, from the category pages that passed.
- **AC-S7**: When a page's `factsHash` and `picksHash` both equal the hashes in its existing file, the file is left untouched (its `computedOn` stays). Otherwise the file is rewritten with `computedOn` set to today's date in `Asia/Bangkok`. The command prints, per page, `unchanged`, `facts changed`, `picks changed`, or `thin`, then runs `seo:index` (index.md, Files) and, for each page whose facts changed, tells you to run `hub-copy:run` for it.
- **AC-S8**: The keyword groups and place list are constants in `apps/api/src/modules/content/seo-slice-facts.constants.ts`, matched case insensitive on word boundaries:
  - `pickup`: `pick up`, `pickup`, `pick-up`, `hotel transfer`, `drop off`; `meal`: `breakfast`, `lunch`, `dinner`, `meal`; `entryFee`: `entrance fee`, `entry fee`, `admission`, `entrance ticket`, `entry ticket`; `guide`: `guide`.
  - Places: Wat Arun, Wat Pho, Grand Palace, Wat Phra Kaew, Damnoen Saduak, Amphawa, Maeklong Railway Market, Ayutthaya, Chao Phraya, Chinatown, Khao San Road, Lumpini, Jim Thompson House, Kanchanaburi, Erawan, Floating Market.
- **AC-S9**: Two reruns on the same data produce byte identical files (keys sorted, arrays in rule order, two space indent, trailing newline).

## Decision

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Where | apps/api content module, beside the tour copy CLIs | Reuses the Prisma types and the membership code | A script in apps/web |
| Connection | One `pg` client (already a dependency) on `DIRECT_URL`, `SET` then `SHOW` before any data query | One connection you can inspect, so the guard is provable; no pooler or Prisma pool to reason about | `PrismaClient` with the option in the URL |
| Refresh | Manual, whenever wanted; date shown on each page | You choose when a diff is worth a PR | Frozen for the test |
| Unchanged rerun | Leave the file untouched | A new date with no data change would mislead the sitemap | Always rewrite |

## Feature design

**API surface**: none. A CLI only, script `"seo:snapshot": "ts-node src/modules/content/seo-snapshot.cli.ts"`, optional `--out <dir>` (default: `apps/web/src/content/seo/bangkok/` from the repo root).

**Value sourcing**:
| Value | Source |
|---|---|
| `computedOn` | today in `Asia/Bangkok`, only when a hash changed |
| `facts.*` | derived from members (AC-S4) |
| pick fields | the representative Tour's columns (AC-S5) |
| hashes | `canonicalHash` (index.md) |

**Security model**: prod is read only by construction (AC-S1). The command never logs `DATABASE_URL`.

**Critical test scenarios**:
- The guard refuses a connection that reports `off`, verifies **AC-S1**.
- A rerun on fixture data leaves files untouched, verifies **AC-S7**, **AC-S9**.
- A 9 member page writes no file and the run exits non zero, verifies **AC-S6**.
- An inclusion "Free cancellation" is skipped for the next one, verifies **AC-S5**.

## Build plan

1. Constants, facts builder and its tests, satisfies **AC-S4**, **AC-S8**.
2. The CLI with the guard, manifest validation and writer, satisfies **AC-S1**, **AC-S2**, **AC-S3**, **AC-S5**, **AC-S6**, **AC-S7**, **AC-S9**.
3. Run it once against prod (read only) and commit the files, satisfies the scope row's done when.

## Rationale (short)

Static files keep pages honest: the reviewer sees every number before it ships, and no request path can leak a live rating. Keeping the date when nothing changed means `lastModified` in the sitemap tells Google the truth.
