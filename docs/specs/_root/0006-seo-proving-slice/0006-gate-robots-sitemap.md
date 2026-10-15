# 0006. Gate allowlist, robots and a slice only sitemap (child of 0006 SEO proving slice)

Scope row 18. Governed by [index.md](index.md): the manifest, the live set and the generated files live there.

## Summary

While the gate is on, anonymous visitors and crawlers reach only the live slice pages, the slice sitemap, click outs and the analytics proxy. Everything else still shows the coming soon page. Robots allows the slice paths and points at `/sitemap-slice.xml`, which lists only live slice pages, each dated from its snapshot. The main `sitemap.ts` is not touched.

## Requirements

**User stories**:
- As a crawler, I want to reach the slice pages and their sitemap while the site is gated, so that the pages can be indexed.
- As Roy, I want every other path to stay gated, so that nothing unfinished gets indexed.

**Acceptance criteria**:
- **AC-G1**: With `SITE_GATE_PASSWORD` set and no preview cookie, a request to `/destinations/bangkok/{slug}` for every slug in `LIVE_SLUGS`, to `/sitemap-slice.xml`, and, once `LIVE_SLUGS` holds at least one slug, to any path starting `/go/tours/` and any path starting `/ingest/` passes through the middleware unchanged. With `LIVE_SLUGS` empty, neither prefix passes: an anonymous visitor reaches no slice page, click out or analytics path (only `/sitemap-slice.xml`, which then holds an empty `<urlset>`).
- **AC-G2**: With the gate on, every other path keeps today's behaviour (rewrite to `/coming-soon` with `x-robots-tag: noindex, nofollow`), including `/destinations/bangkok` itself, any manifest slug not in `LIVE_SLUGS`, `/destinations/bangkok/unknown`, `/go/other`, and `/destinations/bangkok/things-to-do/extra`. Matching is exact on the full pathname, with no trailing slash allowed.
- **AC-G3**: The middleware imports only `live.generated.ts` (slugs only) for the slice, and builds for the edge runtime with no `fs` import.
- **AC-G4**: With the gate on, `/robots.txt` returns `Allow:` lines for each live path, `/sitemap-slice.xml` and `/_next/` (so Google can fetch the scripts, styles and optimised images it renders the pages with), then `Disallow: /`, then `Sitemap: {site.url}/sitemap-slice.xml`. With the gate off, robots is unchanged from today except that it also lists `Sitemap: {site.url}/sitemap-slice.xml`.
- **AC-G5**: `/sitemap-slice.xml` lists exactly the live slice pages, each as an absolute URL on `site.url`, with `lastModified` equal to that page's snapshot `computedOn`. It lists nothing else, gate on or off.
- **AC-G6**: A test enumerates `/sitemap-slice.xml` and asserts that every URL is a live slice page and every live slice page appears once.
- **AC-G7**: The gated `/go/tours/` passthrough does not unlock anything else: `/go/tours/{id}` still returns its 302 with `X-Robots-Tag: noindex` and `Cache-Control: no-store` (spec 0005 AC-9 to AC-11).

## Decision

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Allowlist shape | Exact paths from `LIVE_SLUGS` plus two prefixes (`/go/tours/`, `/ingest/`), the prefixes only while `LIVE_SLUGS` is non empty | A prefix on `/destinations/bangkok/` would expose the unknown path 404 and any held page | One prefix |
| Robots while gated | `Allow` the live paths, then `Disallow: /` | Google uses the most specific rule, so the allows win for those paths only | Keep `Disallow: /` and rely on the sitemap |
| Sitemap | A new route `apps/web/src/app/sitemap-slice.xml/route.ts` returning XML | Leaves `sitemap.ts` (and its `lastModified: now` bug) alone while gated | Branch `sitemap.ts` on the gate |

## Feature design

**Files**:
- `apps/web/src/middleware.ts`: add a `isSlicePath(pathname)` check before the cookie check, built from `LIVE_SLUGS` in a `Set` at module load, plus the two prefix checks, which apply only when `LIVE_SLUGS` is non empty. Put the helper in `apps/web/src/lib/seo-slice-gate.ts` so it is testable without the middleware.
- `apps/web/src/app/robots.ts`: read the live slugs from `LIVE_SLUGS` in `live.generated.ts` (Node runtime, `force-dynamic` stays).
- `apps/web/src/app/sitemap-slice.xml/route.ts`: `export const dynamic = "force-static"`, returns `application/xml` with `<urlset>` built from `LIVE_SLUGS` in `live.generated.ts`; it reads only each slug's `computedOn` from `pages.generated.ts`. `pages.generated.ts` also holds pages that are not live (the local preview renders them, AC-T15), so no public surface takes its slug list from it (index.md Files).

**Value sourcing**:
| Action | Value | Source |
|---|---|---|
| Middleware | the slugs to pass | `LIVE_SLUGS` in `live.generated.ts` |
| Robots | allow lines | `LIVE_SLUGS` in `live.generated.ts`, prefixed `/destinations/bangkok/` |
| Sitemap | the slugs listed | `LIVE_SLUGS` in `live.generated.ts` |
| Sitemap | `<loc>` | `site.url` + `/destinations/bangkok/` + slug |
| Sitemap | `<lastmod>` | the page's snapshot `computedOn`, read from `pages.generated.ts` |

**Key invariants**:
- No list of slice slugs exists outside the generated files.
- A page that is not live (held, snapshot missing, copy missing, `checkHash` stale, or no fact check) is gated, and robots and the sitemap do not list it.

**Critical test scenarios**:
- Gate on, each live path passes and a held slug is rewritten, verifies **AC-G1**, **AC-G2**.
- Trailing slash, extra segment and `/destinations/bangkok` are rewritten, verifies **AC-G2**.
- Robots output gated and open, verifies **AC-G4**.
- Sitemap enumeration, verifies **AC-G5**, **AC-G6**.
- A page that is in `pages.generated.ts` but not in `LIVE_SLUGS` (it has a snapshot and a copy but no fact check) is absent from robots and the sitemap and is rewritten by the gate, verifies **AC-G1**, **AC-G4**, **AC-G5**.

## Build plan

1. `seo-slice-gate.ts` with its unit tests, satisfies **AC-G1**, **AC-G2**, **AC-G3**.
2. Wire it into `middleware.ts`, satisfies **AC-G1**, **AC-G7**.
3. Robots changes and tests (extend `robots.spec.ts`), satisfies **AC-G4**.
4. `sitemap-slice.xml` route and its enumeration test, satisfies **AC-G5**, **AC-G6**.

## Rationale (short)

The gate is the only thing between unfinished pages and the index, so the allowlist is exact and generated, never typed by hand. A held page is gated for the same reason it is left out of the sitemap: one derivation decides both.
