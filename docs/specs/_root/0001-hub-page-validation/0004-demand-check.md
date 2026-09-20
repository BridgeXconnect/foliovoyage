# 0004. Demand check

Child of [0001 hub page validation](index.md). Supports scope row 4. Acceptance criteria: AC-9 in the umbrella.

## Decision

One `dataforseo_labs/google/keyword_overview/live` call per city, with every candidate query in it, through the guard from child 0001.

## Design

**Request**: one task with `keywords` (up to 700, each at most 80 characters and 10 words, checked before sending), `location_code` 2840, `language_code` `en`. Do not set `include_clickstream_data` (it doubles the price). Do not set `include_serp_info` (it does not return the top 10 domains, so it adds nothing here).

**Response use**: for each keyword, keep `search_volume`, `keyword_difficulty`, `search_intent_info.main_intent` and `avg_backlinks_info`. A keyword the provider does not return is not charged and gets `no_data`. Nothing is guessed for it.

**Output**: `demand.json`, one entry per candidate: `query, volume, difficulty, intent, validated (volume at least 100), status (ok or no_data)`.

**Cost**: estimated at 0.012 per task plus 0.00012 per keyword (unverified, from the strategy document), so about 0.02 for 100 keywords. The guard replaces the estimate with the response `cost` in the ledger.

**Rationale, inline**: Keyword Overview allows 700 keywords per task at one task per live call, so a whole city is one cheap call and there is no reason to split it. Costs are per keyword returned, so `no_data` keywords are free, which suits a long tail candidate list.

**Build tasks**: umbrella Build plan tasks 5 and 7.
