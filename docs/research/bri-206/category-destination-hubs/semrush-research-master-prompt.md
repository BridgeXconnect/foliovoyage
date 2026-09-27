# Folio Voyage — SEO research pull via Semrush (programmatic)

## Context (this session has no prior context — read this fully first)

Folio Voyage / Atlas is a map-first travel affiliate site built on Viator's
Partner API. Six live cities: **Bangkok, Kyoto, Lisbon, Rome, Hanoi, Bali**.
Two page types need validation before they're built: **category hub**
pages ("Food tours in Rome") and **destination hub** pages ("Things to do
in Bangkok"). A third type, **attraction hub**, has already been ruled out
(SERP too dominated by competitors) — do not research attraction pages.

The goal of this pull: real data to decide (a) which specific
city/category combinations are worth building a page for at all, and (b)
what such a page actually needs to contain to be competitive. This is
research input for an internal decision process — not a deliverable
report. **Output structured CSV files, not a written summary.** Nothing
here gets copy-pasted into a doc; another process will parse these files
programmatically.

## Source markets — run everything per-market, not once globally

Semrush's keyword data is region-specific, and Atlas earns commission
based on where the *booker* is, not the destination. Run every keyword
pull separately for these markets: **US, UK, AU**. If the connected
Semrush plan doesn't cover all three regional databases, note that
limitation explicitly in a file called `LIMITATIONS.md` and proceed with
whichever are available — don't silently drop a market without saying so.

## Competitor domain list

- `viator.com` — all 6 cities (this is also the answer to "what does
  Viator itself already rank for")
- `getyourguide.com` — all 6 cities
- `klook.com`, `kkday.com`, `trip.com` — Bangkok, Kyoto, Hanoi, Bali only
  (Asia-focused OTAs, low relevance to Lisbon/Rome — skip those two
  cities for these three domains)

## Pre-committed pursue/skip rule — apply mechanically, don't eyeball it

For each validated query, classify each of the top 10 SERP results as:
`marketplace` (any of the domains above), `big_publisher`, `forum`, or
`small_site` (everything else). **Verdict: Pursue if ≥3 of the top 10 are
`small_site`, else Skip.** Compute this as data in the CSV — do not apply
judgment or override it based on anything else observed.

## Required output files (one CSV per file, UTF-8, header row exact as named)

### 1. `keyword_candidates.csv`
Seed from `docs/02`'s page-type patterns ("things to do in {city}",
"{category} tours in {city}", "best time to visit {city}") via Keyword
Magic Tool, one pull per city per source market.

Columns: `query, page_type, city, source_market, search_volume,
keyword_difficulty, search_intent, serp_features, ai_overview_present,
ai_overview_cited_domains`

`serp_features` and `ai_overview_cited_domains` are semicolon-separated
lists within the cell if multiple values.

### 2. `serp_composition.csv`
For every query in file 1 that has real volume (use judgment on a
reasonable floor, note what floor you used in `LIMITATIONS.md`), the
actual top-10 SERP, per source market.

Columns: `query, source_market, rank_position, domain, url,
page_type_observed`

### 3. `query_verdicts.csv`
One row per query per market — the mechanical pursue/skip rule applied.

Columns: `query, city, page_type, source_market, small_site_count_of_10,
verdict`

### 4. `serp_competition_depth.csv`
For each query in file 1: how much of the SERP is consumed before the
first organic result — this changes whether a "Pursue" verdict is
actually worth the click.

Columns: `query, source_market, ads_present, local_pack_present,
ai_overview_present, shopping_unit_present, first_organic_position`

### 5. `ranking_stability.csv`
For the current #1 and #2 ranked URLs per query (from file 2): how long
they've held that position, if Semrush's ranking history shows it.

Columns: `query, source_market, rank_position, domain, url,
estimated_time_at_position, notes`

### 6. `competitor_domain_overview.csv`
One row per competitor domain (file: domain-level snapshot before the
deeper pull).

Columns: `domain, relevant_cities, total_organic_traffic_estimate,
visibility_trend_notes`

### 7. `competitor_hub_positions.csv`
Organic Research → Positions, per competitor domain, **filtered to their
own city/category-hub-shaped URLs specifically** — not their whole
domain. This is the "which of their hub pages actually work" question,
not just "is the company big."

Columns: `domain, ranking_url, url_pattern_type, matched_query,
position, estimated_traffic, source_market`

`url_pattern_type` is your best read of what kind of page it is
(city_hub / category_hub / product_detail / other) based on the URL
structure and title.

### 8. `content_brief_inputs.csv`
For each query with a Pursue verdict only: the actual competitive
content shape, via Keyword Magic Tool's Questions filter and SEO Content
Template / On Page SEO Checker run against the top-10 URLs.

Columns: `query, city, page_type, source_market, paa_questions,
top10_semantic_terms, top10_median_word_count`

`paa_questions` and `top10_semantic_terms` are semicolon-separated lists.

### 9. `seasonality.csv`
For any query whose topic is timing-related (best time to visit,
festival/event-tied, month-specific), the 12-month volume trend.

Columns: `query, city, source_market, jan, feb, mar, apr, may, jun, jul,
aug, sep, oct, nov, dec`

(Monthly columns hold the raw volume figure for that month.)

### 10. `ota_sitemaps.csv` — NOT from Semrush, plain web fetch

For each competitor domain, fetch `robots.txt`, find the sitemap
location, open it, and record real example URLs showing their city-hub
and category-hub URL patterns.

Columns: `domain, sitemap_url, example_city_hub_url,
example_category_hub_url, url_pattern_notes`

## `LIMITATIONS.md`

A plain text/markdown file, not a CSV, noting: which source markets
weren't available, which data points a plan tier couldn't provide, any
query where results looked unreliable or sparse, and any domain that
wouldn't add cleanly to the account.

## Do not

- Do not write a narrative summary or a "report" — the CSVs are the
  deliverable.
- Do not apply subjective judgment to the pursue/skip verdict — it's
  computed, not assessed.
- Do not research attraction-page queries — already ruled out.
- Do not pull anything for Klook/KKday/Trip.com on Lisbon or Rome.
