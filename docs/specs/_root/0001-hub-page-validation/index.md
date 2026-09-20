# 0001. Hub page validation experiments (BRI-206)

**Date**: 2026-09-20
**Status**: In Progress

## Structure

Five decisions, one per scope row. Each child is buildable on its own and carries a short inline rationale.

- [0001-search-data-access-and-spend-guard.md](0001-search-data-access-and-spend-guard.md): how the CLI calls DataForSEO and Viator safely, with credentials, a spend cap, a ledger and a cache. Supports scope row 1.
- [0002-pursue-or-skip-rule.md](0002-pursue-or-skip-rule.md): the four domain classes, the per query and per family rule, and the commit first gate. Supports scope row 2.
- [0003-candidate-list.md](0003-candidate-list.md): tags and attractions from the catalog, ranked, crossed with query templates. Supports scope row 3.
- [0004-demand-check.md](0004-demand-check.md): one Keyword Overview batch per city. Supports scope row 4.
- [0005-results-page-pull.md](0005-results-page-pull.md): one SERP call per validated query, classify, apply the rule. Supports scope row 5.

**Cross child contract**: every paid call goes through the one `SpendGuard` and one `SearchProviderClient` from child 0001. Stages hand each other files (JSON) in `apps/api/research-data/bri-206/<city>/`, never in memory. The rule file from child 0002 must be committed before child 0005 makes its first call.

## Summary

This builds a small command line tool that answers one question: which kinds of hub pages are worth building. It lists what Viator's catalog holds for a city, checks which of those searches people really make, then looks at who ranks for them and applies a rule written down before any results were seen. Every paid call is capped, logged and cached, so the whole experiment should cost well under 5 dollars against a 25 dollar monthly ceiling. It runs as a one off but keeps its raw data, so a rerun costs nothing extra.

## Requirements

**User stories**:
- As Roy, I want a candidate list built from Viator's own catalog so that hub page ideas start from what we can actually sell.
- As Roy, I want each candidate checked against real search demand so that I do not design pages nobody searches for.
- As Roy, I want the pursue or skip rule fixed before any results page is fetched so that the data cannot bend the rule.
- As Roy, I want a hard spend cap and a cost log so that a bug or a typo cannot burn the monthly budget.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: Every stage is a dry run by default. Without `--execute` it makes zero paid calls and prints an estimated cost and call count.
- **AC-2**: Every paid call appends one line to the spend ledger with time, stage, endpoint, keyword count and the cost reported by the provider response.
- **AC-3**: A call is refused before it is sent if the run total plus the estimate would pass the run cap (default 1 dollar, never more than 5), or the month total in the ledger plus the estimate would pass 25 dollars.
- **AC-4**: A repeated request (same endpoint and same parameters) is served from the cache with no charge, and every raw provider response is kept on disk.
- **AC-5**: Provider credentials come only from the process environment (Doppler). A missing credential stops the run with a plain message. No credential appears in logs, the ledger, the cache or any output file.
- **AC-6**: A dated rule file exists in git before any results page is pulled. The results stage refuses to run if the file is missing, has uncommitted edits, or its commit is newer than the first results call. Every results output records the rule file's commit hash.
- **AC-7**: For one city, the candidate stage writes a ranked list of tags and attractions with product counts and ratings, crossed with the query templates, using zero paid calls to the search provider.
- **AC-8**: The candidate list is deterministic: the same database, tag names file and cutoffs give the same list in the same order.
- **AC-9**: The demand stage sends one Keyword Overview call per run with at most 700 keywords, each within 80 characters and 10 words. Every candidate ends with a volume figure or an explicit `no_data` mark.
- **AC-10**: The results stage fetches only candidates that pass the demand threshold, one call per query, and stores the top 10 organic results for each.
- **AC-11**: Every domain in each top 10 gets exactly one class. Domains on no list default to small site and are also written to an unlisted report so a person can review them.
- **AC-12**: Each query gets a small site count and an open or closed mark. Each query family gets pursue, skip or insufficient data, exactly as the rule file states.

## Decision

**Chosen option**: Option 2: A script based CLI in `apps/api`, credentials in Doppler, default dry run with a hard cap.

Build the experiment as `research:hub` in `apps/api/src/modules/research/`, calling DataForSEO and Viator directly from code, not through the session MCP connector.

## Feature design

**Data model sketch**: No database changes. Inputs are existing `City` and `Tour` rows (read only: `Tour.tags`, `Tour.ratingAvg`, `Tour.ratingCount`, `Tour.destinationRefs`, `City.viatorDestRef`). Everything the tool writes is files:

```
apps/api/research-data/            (gitignored, per machine)
  ledger.jsonl                      one line per paid call
  cache/<sha256>.json               raw provider responses, keyed by endpoint plus params
  viator/tags.json                  tag id to name, from one /products/tags call
  viator/attractions-<ref>.json     attractions per destination ref (if the spike confirms)
  bri-206/<city>/
    candidates.json / .csv          ranked candidate queries with counts and ratings
    demand.json                     volume or no_data per candidate
    serp.json                       top 10 organic results per validated query
    classified.json                 class per domain per query, plus verdict per query
    unlisted-domains.csv            domains that fell to the small site default
docs/research/bri-206/              (committed)
  rule.md                           the dated pursue or skip rule (child 0002)
  findings.md                       the roll up table (scope row 7)
```

**State transitions**: none. Stages are separate commands: `candidates`, `demand`, `serp`, `classify`. Each reads the previous stage's file.

**Interface** (a CLI, no HTTP API):
| Command | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `research:hub candidates --city <slug>` | city slug | `candidates.json` | DB url, Viator key | unknown city, empty catalog |
| `research:hub demand --city <slug> [--execute]` | city slug | `demand.json`, ledger line | DataForSEO login and password | cap refused, over 700 keywords |
| `research:hub serp --city <slug> [--execute]` | city slug | `serp.json`, ledger lines | DataForSEO login and password | rule file gate, cap refused |
| `research:hub classify --city <slug>` | city slug | `classified.json`, `unlisted-domains.csv` | none | missing `serp.json` |
| `research:hub spend` | none | month total, run total, cap | none | none |

**Value sourcing** (every value each action produces or displays names where it comes from):
| Action | Value produced | Source |
|---|---|---|
| candidates | tag product count, average rating | `Tour` rows where `destinationRefs` overlaps the city's `viatorRefs` (`curated-cities.ts`), grouped by `unnest(tags)`, not deleted |
| candidates | tag name | `viator/tags.json` from one `/products/tags` call, cached |
| candidates | attraction name and product count | `/attractions/search` if it returns a count, else a title match count over `Tour.title` (spike, see child 0003) |
| candidates | cutoffs (top N, minimum products) | constants in child 0003 |
| candidates | query text | templates in child 0003 crossed with tag, attraction and city names |
| demand | search volume, difficulty, intent | DataForSEO `keyword_overview/live`, location 2840, language `en` (assumption, child 0004) |
| demand | estimated cost | price table constants in code, replaced by the response `cost` once received |
| serp | top 10 organic domains and ranks | DataForSEO `serp/google/organic/live/regular`, `items` where `type` is `organic` |
| classify | class per domain | the lists and suffix rules in `rule.md` (child 0002) |
| classify | verdict per query and per family | the thresholds in `rule.md` |
| all paid calls | actual cost | response field `cost` from the provider, never our estimate |
| all paid calls | month total | sum of this month's lines in `ledger.jsonl` |
| guard | run cap | `HUB_RESEARCH_MAX_USD`, default 1, clamped to at most 5 in code |

**Key invariants**:
- No paid call is sent without passing `SpendGuard.check()` first. There is one code path to the provider, and it lives in one client.
- The ledger only grows. It is never rewritten.
- The results stage cannot run before the rule file is committed (AC-6).
- Raw responses are never edited. Later stages read them, they do not change them.

**Security model**:
- Credentials: `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` in Doppler `foliovoyage` config `dev` only, never `prd`. The Viator key already exists (`VIATOR_API_KEY`). Nothing is written to any `.env` file.
- Outbound calls go through `AllowlistFetch` with only `api.dataforseo.com` and the Viator host allowed.
- The auth header is built at call time and never logged. Errors print the endpoint and status, not headers or bodies with credentials.
- Read access to the database uses the existing `DATABASE_URL`. The tool only runs `SELECT`.
- `research-data/` is gitignored. It holds provider data that may carry usage terms, so it is not committed without a check (see Follow-up).

**Configuration required**:
- `DATAFORSEO_LOGIN`: API login (the API credentials page, not the account password). Doppler `dev`. Optional in `env.validation.ts`, so a Railway boot is never broken.
- `DATAFORSEO_PASSWORD`: API password. Doppler `dev`. Optional in `env.validation.ts`.
- `HUB_RESEARCH_MAX_USD`: run cap in dollars, default 1, maximum 5. Optional.
- All three added to `apps/api/.env.example` with comments. The CLI errors clearly if a login or password is missing.

**Critical test scenarios** (each maps to an acceptance criterion):
- Happy path: one city end to end on real calls, three hand picked candidates first, then the full list, verifies **AC-7**, **AC-9**, **AC-10**, **AC-12**
- Dry run: `demand` without `--execute` makes no network call and prints an estimate, verifies **AC-1**
- Cap: a batch whose estimate passes the cap is refused with nothing sent, and the ledger is unchanged, verifies **AC-3**
- Month ceiling: a ledger seeded to 24.95 dollars refuses a 0.10 dollar call, verifies **AC-3**
- Cache: the same demand request run twice charges once, and the second run adds no ledger line, verifies **AC-4**
- Secrets: a missing credential stops the run, and a full run's outputs contain no credential string, verifies **AC-5**
- Rule gate: results stage refuses when `rule.md` is missing, dirty, or committed after the first results call, verifies **AC-6**
- Determinism: two candidate runs on the same inputs are identical, verifies **AC-8**
- Limits: 701 keywords, an 81 character keyword and an 11 word keyword are each rejected before sending, verifies **AC-9**
- Classification: a fixed set of sample domains gets the expected classes, and an unlisted domain is small site and appears in the unlisted report, verifies **AC-11**
- Verdict: a hand built top 10 with 2 small sites is closed and with 3 is open, verifies **AC-12**

## Build plan

Ordered for Tracer Bullet: guard first, then a thin thread on one city, then thicken.

1. [x] Add the three env vars to `env.validation.ts` and `.env.example`, gitignore `apps/api/research-data/`, load credentials into Doppler `dev`, add the `research:hub` script, satisfies **AC-5**
2. [x] Build `SpendGuard` (run cap, month ceiling, ledger, dry run) and the cached `SearchProviderClient` on `AllowlistFetch`, with jest specs for the guard math, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**
3. Prove the client with one real cheap call (one keyword) and check the ledger cost against the provider dashboard, satisfies **AC-2**
4. Write `docs/research/bri-206/rule.md` from child 0002, get Roy's sign off, commit it, and build the commit first gate, satisfies **AC-6**
5. Thin thread for one city (Bangkok) with three hand picked queries through demand, results pull, classify and verdict, satisfies **AC-9**, **AC-10**, **AC-11**, **AC-12**
6. Thicken candidates: the full tag and attraction ranking from the catalog with the query templates, satisfies **AC-7**, **AC-8**
7. Thicken demand and results: the full batch for the city, the unlisted report, the per family verdicts, satisfies **AC-9**, **AC-10**, **AC-11**, **AC-12**

Scope rows 6 (all six cities) and 7 (findings) reuse these commands and are not part of this build plan.

## Consequences

**Positive**:
- A repeatable, capped, logged way to buy search data, reusable for the 100 city case later (about 4 dollars by the strategy estimate).
- The rule cannot be bent by the data because the tool enforces the order.
- Candidate tags cost nothing to fetch because `Tour.tags` already holds them.

**Negative / tradeoffs**:
- More machinery than a throwaway script: five decisions and a guard for an experiment that may cost under a dollar.
- The month ceiling check only sees this machine's ledger. The provider dashboard stays the source of truth.
- Only tag IDs are stored on `Tour`, so tag names need one extra Viator call and a cache file.

**Neutral**:
- Adds a `research` folder to `apps/api` that is plain TypeScript, not a Nest module.
- Adds two Doppler secrets to `dev`.

## Rationale

See [rationale.md](rationale.md).

## Follow-up

- [ ] Confirm the real prices for Keyword Overview and SERP (live and queue) from DataForSEO's pricing page, and replace the estimate constants. The 0.012 plus 0.00012 per keyword and 0.002 and 0.0006 per page figures come from the strategy document and are unverified.
- [ ] Confirm the account balance call (`appendix/user_data`) is free, then use it as a second check on the month total.
- [ ] Spike `/attractions/search`: does it return a product count or rating? (Child 0003.)
- [ ] Check Viator's terms on caching and using attraction and tag data (the guide says cache and refresh weekly), and DataForSEO's terms on keeping and committing raw results.
- [ ] Decide whether `research-data/` raw files are ever committed. Default is no.
- [ ] Rotate the Doppler CLI token that was printed in the session transcript when `doppler configure debug` was run.
- [ ] Collections (hand made groups of experiences) cannot be derived from the catalog, so they are not in the candidate list. Decide with BRI-205 whether to test them separately.
