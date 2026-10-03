# Scope: BRI-206 hub page validation

Two cheap experiments that decide which hub page types (BRI-205) are worth designing at all (rows 1 to 7). Spans both apps. See the legend in [index.md](index.md#legend) for the status words and the feature lifecycle.

## Foundations

### 1. Search data access and spend guard · in-progress
A safe way to call the search data provider you already chose, with credentials handled the project way and a hard cap so the monthly ceiling cannot be crossed by accident. Nothing in the repo wires this up yet. code in `apps/api/src/modules/research/`
**Done when:** one cheap test call works with project managed credentials, a spend cap refuses any call that would pass the budget, and every call's cost is written to a log.
- [x] Design it (spec): [0001](../../specs/_root/0001-hub-page-validation/index.md), child [0001-search-data-access-and-spend-guard.md](../../specs/_root/0001-hub-page-validation/0001-search-data-access-and-spend-guard.md)
- [x] Build it: `/develop search data access and spend guard`
  - [x] Env vars, gitignore and script wiring (AC-5)
  - [x] Spend guard, ledger, cache and client with specs (AC-1 to AC-5)
  - [x] One real cheap call checked against the provider dashboard (AC-2)
- [x] Verify it: `/check verify search data access and spend guard`

### 2. Pursue or skip rule, written first · in-progress
The rule that turns a classified results page into a pursue or skip call, plus how a domain is put in one of four classes (marketplace, big publisher, forum, small site). It must exist before any results page is pulled, so the data cannot bend the rule.
**Done when:** the rule, the class definitions, and the threshold (for example three or more small sites in the top ten) are saved in a dated file before the first results page is fetched.
- [x] Design it (spec): [0001](../../specs/_root/0001-hub-page-validation/index.md), child [0002-pursue-or-skip-rule.md](../../specs/_root/0001-hub-page-validation/0002-pursue-or-skip-rule.md)
- [ ] Build it: `/develop pursue or skip rule, written first`
  - [ ] Rule file written from the spec and signed off by Roy (AC-6)
  - [ ] Commit first gate in the results stage (AC-6)
- [ ] Verify it: `/check verify pursue or skip rule, written first`

## Slice 1: one city, end to end

### 3. Candidate list from the catalog (one city) · in-progress
List the attractions and tags the Viator catalog holds for one city, ranked by product count and rating, and cross them with the page type query shapes into a ranked list of candidate queries. Tags come free from the tour rows already in the database, tag names need one Viator call, and attractions need a short spike to see whether they carry counts.
**Done when:** one city has a ranked candidate query list with counts and ratings, saved as a file.
- [x] Design it (spec): [0001](../../specs/_root/0001-hub-page-validation/index.md), child [0003-candidate-list.md](../../specs/_root/0001-hub-page-validation/0003-candidate-list.md)
- [ ] Build it: `/develop candidate list from the catalog (one city)`
  - [ ] Tag ranking from Tour rows and tag names file (AC-7, AC-8)
  - [ ] Attractions spike and ranking, then query templates (AC-7, AC-8)
- [ ] Verify it: `/check verify candidate list from the catalog (one city)`

### 4. Demand check (one city) · in-progress
Send that city's candidate queries to the search data provider in one batch to see which ones people really search for, and keep the raw responses so nothing is paid for twice.
**Done when:** each candidate has a demand figure or a clear no data mark, the batch cost is a few cents and logged, and raw responses are saved.
- [x] Design it (spec): [0001](../../specs/_root/0001-hub-page-validation/index.md), child [0004-demand-check.md](../../specs/_root/0001-hub-page-validation/0004-demand-check.md)
- [ ] Build it: `/develop demand check (one city)`
  - [ ] Keyword Overview batch with limits check and no_data marks (AC-9)
  - [ ] Full city run through the guard (AC-9)
- [ ] Verify it: `/check verify demand check (one city)`

### 5. Results page pull and domain classes (one city) · in-progress
For the queries that pass the demand check, fetch the results page, put each domain in a class under the rule from row 2, and count small sites in the top ten. Runs only after row 2 is saved.
**Done when:** each validated query has a classified top ten and a pursue or skip call by the written rule, with every domain's class visible.
- [x] Design it (spec): [0001](../../specs/_root/0001-hub-page-validation/index.md), child [0005-results-page-pull.md](../../specs/_root/0001-hub-page-validation/0005-results-page-pull.md)
- [ ] Build it: `/develop results page pull and domain classes (one city)`
  - [ ] Thin thread: three hand picked queries end to end (AC-10, AC-11, AC-12)
  - [ ] Classifier, unlisted report and per family verdicts (AC-11, AC-12)
  - [ ] Full city results pull (AC-10)
- [ ] Verify it: `/check verify results page pull and domain classes (one city)`

## Slice 2: all six cities

### 6. Widen to all six cities
Repeat rows 3 to 5 for the other five cities, checking the running spend before each batch.
**Done when:** all six cities have a call per query family, and total spend stays under the budget and is logged.
- [ ] Build it: `/develop widen to all six cities`

## Slice 3: the answer

### 7. Findings and hand off to BRI-205
Roll the results up per page type family into a pursue or skip table, with the evidence and the total cost, so BRI-205 can design only what earned it.
**Done when:** one table has a call per page type family with its evidence and cost, and it is linked from BRI-206.
- [ ] Build it: `/develop findings and hand off`

## Deferred
Out of scope for the current build pass, kept so the plan stays honest.
- **Reusable command for reruns and a future 100 cities**: about $4 by the strategy estimate, but you chose a one off with saved raw results · needs a decision
- **Rank the next cities to add by demand times catalog depth**: a second use of the same candidate list (strategy section 1.5) · needs a decision
