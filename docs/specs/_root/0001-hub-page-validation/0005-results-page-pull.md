# 0005. Results page pull and domain classification

Child of [0001 hub page validation](index.md). Supports scope row 5. Acceptance criteria: AC-6, AC-10, AC-11 and AC-12 in the umbrella.

## Decision

One `serp/google/organic/live/regular` call per validated query, through the guard, only after the rule gate from child 0002 passes. Then classify and apply the rule from `rule.md`.

## Design

**Request**: one keyword per request (the endpoint does not batch), `location_code` 2840, `language_code` `en`, `depth` 10 (one page, the default). No search operators (`site:`, `intitle:` and the like multiply the price by 5).

**Response use**: from `items`, keep those with `type` of `organic`, in `rank_group` order, taking `domain`, `url`, `rank_group`. Strip a leading `www.`. A domain appearing twice in the top 10 counts once, at its best rank. Featured snippets, people also ask, maps and video blocks are ignored.

**Classification**: the lists and rules in `rule.md` decide each domain's class. The classifier is a pure function of `(domain, url, lists)` so it is easy to test. Unlisted domains default to small site and are written to `unlisted-domains.csv` with the queries they appeared in.

**Output**: `serp.json` (raw top 10 per query, with the rule commit hash and first call time), `classified.json` (class per domain per query, small site count, open or closed, and the family verdict).

**Cost**: estimated at 0.002 per page live, or 0.0006 through the standard queue (`task_post` then `task_get`). The live endpoint is used first because it is simpler. Switch to the queue only if the spike shows the saving matters, since the difference on 300 pages is about 0.42 dollars. Both prices are unverified.

**Failure handling**: a failed call is not retried automatically. The guard has already counted nothing for it, the error is written to a `failures` array, and a person reruns the stage, which skips cached queries.

**Rationale, inline**: doing the classification as a separate, pure step over saved raw responses means the rule can be reapplied to the same data for free, and a wrong class list never needs a second purchase.

**Build tasks**: umbrella Build plan tasks 4, 5 and 7.
