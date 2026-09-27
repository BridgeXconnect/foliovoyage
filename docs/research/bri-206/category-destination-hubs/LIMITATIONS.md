# LIMITATIONS

Run date: 2026-09-24. Semrush data accessed through the logged-in web UI
(the Semrush MCP/API had zero API units; every MCP call returned
`no_api_units`, so the web app's own JSON-RPC endpoints behind Keyword
Overview, Domain Overview and Organic Research were used instead).

## Source markets

All three regional databases (US, UK, AU) were available on this plan and
every keyword pull was run per market. No market was dropped.

## Seed list (file 1)

Keyword Magic Tool's bulk UI could not be driven programmatically (its
input field would not register text). Seeds were therefore generated from
the page-type patterns in `docs/02` as an explicit list of 14 patterns x 6
cities = 84 queries, and each was looked up individually per market:

- destination_hub: "things to do in {city}", "{city} tours", "best tours in {city}"
- category_hub: "food tours in {city}", "{city} food tour", "walking tours in
  {city}", "day trips from {city}", "{city} day trips", "cooking class {city}",
  "{city} night tours", "boat tours in {city}", "bike tours in {city}",
  "{city} street food tour"
- seasonal_destination: "best time to visit {city}"

`keyword_candidates.csv` therefore holds exactly 252 rows (84 x 3 markets).
Broad-match expansions (e.g. "things to do in bangkok thailand") were NOT
pulled into file 1. Expansion data was only used for PAA questions (file 8).

Rows with an empty search_volume (10 of 252) are queries Semrush has no
record of in that market: boat tours in kyoto (US/UK/AU), boat tours in
hanoi (US/UK/AU), walking tours in bali (US/UK), lisbon street food tour (UK),
hanoi night tours (UK).

## SERP snapshot availability (files 2, 3, 4, 5)

Semrush only stores a SERP snapshot for keywords it has crawled. 101 of the
242 recorded query/market rows had no stored SERP (almost all are
volume < 100 in that market). For those rows:

- `query_verdicts.csv` carries `verdict = no_data` and an empty
  small_site_count_of_10. They are NOT Pursue and NOT Skip.
- `serp_competition_depth.csv` still reports ads / local pack / AI overview /
  shopping flags from the keyword's SERP-feature list, but
  first_organic_position is blank.
- They are absent from `serp_composition.csv` and `ranking_stability.csv`.

Volume floor for `serp_composition.csv`: search_volume >= 50 in that
market. 6 query/market rows with a stored SERP fell below the floor and were
excluded from file 2 only (they are still scored in file 3).

The SERP snapshot dates vary per keyword (Semrush "Updated" date, mostly
Jun-Sep 2026). No "Update metrics" refreshes were purchased.

## Domain classification used for the pursue/skip rule (file 3)

Classification is mechanical, by domain:

- `marketplace`: viator.com, getyourguide.com, klook.com, kkday.com,
  trip.com (and their subdomains / country TLD variants).
- `forum`: reddit.com, quora.com, community.ricksteves.com, facebook.com
  /groups/, fodors.com/community, Lonely Planet Thorntree, StackExchange,
  and any TripAdvisor ShowTopic / ShowForum URL.
- `big_publisher`: an explicit allow-list of large media, OTA, hotel,
  airline, tourism-board and social/video domains (TripAdvisor, Lonely
  Planet, Conde Nast Traveler, Time Out, Forbes, NYT, Guardian, Telegraph,
  Travel + Leisure, AFAR, Fodor's, Frommer's, Rough Guides, Culture Trip,
  PlanetWare, Touropia, TripSavvy, Wikipedia/Wikivoyage, YouTube, TikTok,
  Instagram, Pinterest, Google, National Geographic, BBC, US News,
  Australian/UK national press, Headout, Tiqets, Civitatis, Musement, Airbnb,
  Agoda, Hotels.com, Expedia, Booking.com, Kayak, Skyscanner, Contiki,
  Intrepid, G Adventures, TourRadar, Trailfinders, Royal Caribbean, Rick
  Steves, Substack, Medium, official tourism boards, .gov/.edu, etc.). The
  full list is the `BIG` array in the build script.
- `small_site`: everything else. NOTE this includes independent tour
  operators and mid-size OTAs (e.g. eatingeurope.com, withlocals.com,
  urbanadventures.com, citywonders.com, guruwalk.com, secretfoodtours.com,
  gowithguide.com, cookly.me, contexttravel.com) because the brief defines
  small_site as "everything else". If those should count as marketplaces,
  re-run with an extended marketplace list; the verdict may flip for
  food-tour and cooking-class queries.

Only true organic results (kind = organic) at positions 1-10 are counted.
Feature blocks (local pack, PAA, AI Overview, forums block, video carousel)
are excluded from the 10.

## SERP feature codes (files 1, 4)

Semrush returns numeric feature codes; names were mapped with Semrush's
published code list (0-49) plus code 50 = AI Overview, which was verified
empirically (code 50 rows in the SERP list carry the AI Overview cited
sources). `ai_overview_cited_domains` = distinct domains of those code-50
entries.

`first_organic_position` = 1 + (1 if "Ads top" present) + number of
distinct feature blocks Semrush places at SERP position 1 (local pack, AI
Overview, video carousel, etc.). Semrush positions feature blocks relative
to organic results, so this is an approximation of "how many blocks sit
above organic #1", not a pixel measurement. `ads_present` is yes if any of
Ads top / Ads bottom / Ads middle is in the SERP-feature list.

## Ranking stability (file 5)

Keyword Overview only exposes the CURRENT SERP snapshot. Per-URL position
history requires Position Tracking (project-based, not set up) or the
Organic Research "Position changes" report, which is domain-scoped, not
keyword-scoped. `estimated_time_at_position` is therefore `unknown` for
every row; the notes column records the snapshot crawl date and the page
type of the ranking URL.

## Competitor domain overview (file 6)

Scraped from Domain Overview (desktop, Sep 23 2026) per market. Figures are
Semrush estimates. "Key topics" are only populated for US and UK (the AU
view showed a placeholder). MoM changes are Semrush's month-over-month
deltas as displayed.

## Competitor hub positions (file 7)

Pulled from Organic Research > Positions using subfolder / URL scope so
only hub-shaped URLs are included:

- viator.com: `/{City}/` (geo hub + `-ttd`) and `/{City}-tours/` (group,
  category, tag hubs). Product pages (`/tours/...`) excluded.
- getyourguide.com: `/{city}-l{id}/` scope; classified by URL suffix
  (`-l{id}/` or `/ttd/` = city_hub, `-tc{id}/` or day-trips `-tl{id}/` =
  category_hub, `-t{id}/` = product_detail, dropped).
- klook.com: `/en-US/`, `/en-GB/`, `/en-AU/` and locale-less
  `/destination/c{id}-{city}/` scopes; `/destination/c{id}-{city}/` =
  city_hub, `/destination/c{id}-{city}/{catId}-{cat}/` and
  `/experiences/list/` = category_hub, `/activity/` dropped.
- kkday.com: `/en-us/`, `/en/`, `/en-gb/`, `/en-au/` destination URLs and
  `/category/{cc}-{city}/` subfolders. The destination (city hub) URLs
  returned zero ranking keywords in all three markets; only category
  `/list` pages rank.
- trip.com: `/things-to-do/experiences/` subfolder (top 600 keywords by
  traffic per market, then filtered to the four Asia cities by URL) plus the
  four city hubs `/things-to-do/bangkok-191/`, `/kyoto-430/`,
  `/hanoi-181/`, `/bali-438/` as exact URLs. The city hubs returned zero
  ranking keywords in all three markets (US/UK/AU). Trip.com category hubs
  outside the top 600 by traffic in a market are not included.

Only the top 200 keywords by traffic per scope per market were pulled
(page size 100, 2 pages), so very long-tail positions are truncated for
big scopes (e.g. getyourguide.com/rome-l33/ has 7,762 US keywords; 200
included). Lisbon/Rome were not pulled for Klook, KKday or Trip.com.
Rows are de-duplicated on (domain, url, keyword, market).

## Content brief inputs (file 8)

The Content Toolkit (SEO Content Template, On Page SEO Checker) is NOT on
this subscription (paywalled at $60/mo), so:

- `paa_questions` come from Semrush Keyword Overview's Questions list
  (Semrush data, per market).
- `top10_semantic_terms` and `top10_median_word_count` were computed by
  fetching the current top-10 organic URLs directly (plain HTTP, browser
  user agent) and extracting main-content text. 710 unique URLs were
  fetched: 428 ok, 253 blocked (HTTP 403, mostly TripAdvisor, Lonely Planet,
  Reddit, Viator, GetYourGuide, Klook), 10 rate-limited (429), 19 other
  errors. Word counts and terms are therefore based on the fetchable subset
  of each top 10 (typically 4-8 pages). Terms are the most frequent
  two-word phrases shared by >= 30% of fetched pages after boilerplate
  filtering; they are a proxy for SCT's semantically related keywords, not
  the SCT output. Video/social URLs were skipped.

## Seasonality (file 9)

Semrush exposes a 12-month trend as an index (0-100), not raw monthly
volume. Monthly figures = round(search_volume x index_m / mean(index)),
which preserves the annual average. The 12 months are the trailing 12
months ending at the snapshot; the first column (jan) is the OLDEST month
in Semrush's trend array and dec the most recent, they are not calendar
months. Only "best time to visit {city}" queries qualified as
timing-related; no festival/month-specific seeds were included in the seed
list. Rows are only written where Semrush had trend data (16 of 18).

## OTA sitemaps (file 10)

See earlier notes: viator.com, getyourguide.com, kkday.com return 403 to
non-browser fetchers (read via browser); trip.com declares no sitemap and
its patterns come from live internal links; Viator Hanoi/Bali dest ids and
KKday Lisbon/Rome not probed.

## Account / quota

Keyword Overview lookups: 252 keyword/market pairs were queried; whether each
counts against the daily Keyword Overview allowance (1,000) was not verified.
No domains needed adding to the account; all reads were
ad hoc. No project, Position Tracking or Site Audit was created.
