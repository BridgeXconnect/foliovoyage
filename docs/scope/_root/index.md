# Scope map: Folio Voyage (Atlas)

Folio Voyage is a travel affiliate platform with curated destination guides and bookable experiences. This scope started as one slice, two cheap experiments that decide which hub page types (BRI-205) are worth designing. It now holds five areas, split into one file each (see Epics below). It spans both apps, so it lives in `_root`.

**Build approach:** Tracer Bullet (prove the whole path on one city with real calls first, then widen to six).
**Workflow:** Alpha (after develop, run check verify). The project default level of rigor. `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Any feature can carry its own tag (for example `· GA`) to do more or less.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| A | Viator import pipeline and curated cities | Existing | existing |
| B | Hand written destination pages for six cities | Existing | existing |
| 1 | Search data access and spend guard | Foundation | in-progress |
| 2 | Pursue or skip rule, written first | Foundation | in-progress |
| 3 | Candidate list from the catalog (one city) | Slice 1 | in-progress |
| 4 | Demand check (one city) | Slice 1 | in-progress |
| 5 | Results page pull and domain classes (one city) | Slice 1 | in-progress |
| 6 | Widen to all six cities | Slice 2 | planned |
| 7 | Findings and hand off to BRI-205 | Slice 3 | planned |
| 8 | AI generated tour copy (`ai_summary`) | Content engine | in-progress |
| 9 | Show AI tour copy on the web | Content engine | planned |
| 10 | Nightly AI tour copy generation | Content engine | planned |
| 11 | Sampled evaluation and kill switch for AI tour copy (BRI-201) | Content engine | in-progress |
| 12 | Canvas feed endpoint (BRI-225) | Canvas slice 1 | in-progress |
| 13 | Canvas layout and rendering (region layout, culler, pan) | Canvas slice 1 | shelved |
| 14 | Canvas navigation (minimap, bucket search, shareable position URLs) | Canvas slice 2 | shelved |
| 15 | Canvas tile design (tile shape rules, hover caption, visual direction) | Canvas slice 3 | shelved |
| 16 | New database backed tour page for canvas tiles (from spec 0004) | Canvas follow up | in-progress |
| 17 | Block the canvas rating path in robots.txt (from spec 0005) | Canvas follow up | done |
| 18 | Gate allowlist, robots and a slice only sitemap | SEO foundation | in-progress |
| 19 | Page list and tour membership rule | SEO foundation | in-progress |
| 20 | Snapshot files from prod, read only | SEO foundation | in-progress |
| 21 | Hub page template and URL | SEO slice 1 | in-progress |
| 22 | Rating free pick card and campaign tagged click out | SEO slice 1 | in-progress |
| 23 | Hub copy in the house voice | SEO slice 1 | in-progress |
| 24 | The five category pages and the first batch calibration | SEO slice 2 | in-progress |
| 25 | Stats page | SEO slice 2 | in-progress |
| 26 | Search Console and measurement plumbing | SEO slice 3 | in-progress |
| 27 | Checkpoint readouts at weeks 2, 4, 8 and 12 | SEO slice 3 | in-progress |

## Epics

| Epic | What it covers | Rollup |
|---|---|---|
| [already built](already-built.md) | The import pipeline and the hand written destination pages, for context | 2 existing |
| [hub page validation](hub-page-validation.md) | BRI-206, rows 1 to 7 | 0 of 7 done, 5 designed and in progress |
| [content engine](content-engine.md) | BRI-154 AI tour copy and BRI-201 its sampled evaluation, rows 8 to 11 | 0 of 4 done, 2 designed and in progress |
| [discovery canvas](discovery-canvas.md) | EP-20 (BRI-223), rows 12 to 17, rows 12 to 15 tagged Beta; view shelved 8 Oct 2026 (BRI-245) | 1 of 6 done, 2 designed and in progress (feed, tour page), 3 shelved |
| [SEO proving slice](seo-proving-slice.md) | BRI-114, Bangkok: 7 pages (hub, 5 category pages, stats; muay thai and spa held) indexed while the site stays gated, rows 18 to 27, row 18 tagged Beta | 0 of 10 done, 10 designed and in progress (spec 0006) |

## Legend

**The decision box.** Every feature that needs a decision carries exactly one, the sub task whose label ends with `(spec)`. Skills locate it by that `(spec)` suffix, never by an exact label. Every other box is an execution box and `/architect` never ticks one.

**Feature lifecycle**:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | `/architect` at spec capture | `Design it` ticked, spec linked, `Build it: /develop <feature>` with 2 to 5 milestones, then `Verify it` (Alpha and up) |
| `in-progress` (building) | `/develop` | milestone boxes tick one by one, code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` and milestones ticked, `Verify it` ticked |
| `done` | you, when you decide it is | boxes you ran ticked, skipped ones marked skipped; for Alpha, after `/check verify` is the suggested point |

- **Next step** is the first unticked box.
- **needs a decision** means run `/architect` first; otherwise go straight to `/develop`.
- **Status** goes `planned`, then `in-progress`, then `done`, plus `existing` (built before this workflow), `shelved` (designed or built, then set aside on purpose; kept for history) and `dropped`.
- **Workflow** (header line) is the project default. Alpha means `/check verify` after `/develop`, with no separate test suite or review.
