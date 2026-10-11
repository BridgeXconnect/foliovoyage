# BRI-206 findings: which hub page types are worth building

Run of 2026-10-11, six cities, under `rule.md` as committed before the pulls (`8095dd9`), with the domain lists corrected afterwards (`d9c5921`). Every number below was rebuilt from the saved run files (`classified.json`, `demand.json`, `serp.json`, `candidates.json` for each city, and `ledger.jsonl`), not copied from a report.

## 1. What this answers

For six cities, which hub page types (things to do, category/tag, attraction, best time to visit) can a small site realistically rank for, so which are worth building first? The rule file, committed before any results page was pulled, turns that into one pursue or skip per page type.

## 2. Method in brief

- **Candidates** come from Viator's catalogue for each city: its top 25 tags and top 25 attractions, each in two query forms ("X in city" and "best X in city"), plus one things-to-do and one best-time query: 102 per city (100 for Rome). Tags are ranked by product count and rating, minimum 10 products.
- **Internal Viator tags are removed** before the cut (`INTERNAL_TAGS` in `candidates.ts`, matched by exact id, 17 ids). They are operational labels in the `/products/tags` vocabulary that nobody searches for. Ids: 367653 Low Supplier Cancellation Rate, 367654 Low Last Minute Supplier Cancellation Rate, 367656 Zombie, 367658 New Product, 367661 Short term availability, 367664 Weather Dependent - Moderate, 367667 Weather Dependent - Weather-Proof, 367668 Agent Low Quality Product (all seen in Bangkok's top 25 in the earlier September run, with `no_data` on every query; that run informed the filter only and feeds no verdict here); 367650 Additional fees, 367651 DSA non-compliant, 367657 Zombie Slice, 367659 Curated Catalog, 367662 Agent Favorite, 367663 Weather Dependent - Low, 367665 Weather Dependent - High, 367666 Weather Dependent - Extreme, 367669 Conditional Booking Questions (same unparented block, internal by name only). Top Product, Worry-Free Shore Excursion, Excellent Quality, Port Pickup and the two Viator Experience Awards were left in on purpose, so the data decides.
- **Demand check:** one Keyword Overview call per city. A query is *validated* at 100 or more searches a month.
- **One results-page pull** per validated query (top 10 organic, one result per domain).
- **Four domain classes:** marketplace, forum or social, big publisher or official, small site (the default for anything unlisted).
- **Thresholds as they stand in `rule.md`:** demand floor 100 a month; a query is *open* with at least 3 small sites in the top 10, else closed; a family needs at least 5 validated queries across the cities pulled (fewer is "insufficient data", not a skip); *pursue* if at least half of validated queries are open, else *skip*.
- **Market:** US, English only (DataForSEO location 2840, language `en`). See section 5b.

## 3. Per-city numbers

| City | Candidates | Validated | Validated share | Results pages | Cost |
|---|---|---|---|---|---|
| Kyoto | 102 | 7 | 6.9% | 7 | $0.0286 |
| Lisbon | 102 | 8 | 7.8% | 8 | $0.0311 |
| Hanoi | 102 | 5 | 4.9% | 5 | $0.0234 |
| Rome | 100 | 19 | 19.0% | 19 | $0.0543 |
| Bali | 102 | 4 | 3.9% | 4 | $0.0219 |
| Bangkok | 102 | 9 | 8.8% | 9 | $0.0325 |
| **Total** | **610** | **52** | **8.5%** | **52** | **$0.1920** (unrounded $0.19196) |

Row costs are rounded to four places, so they sum to $0.1918. Cost is the city's demand call plus $0.002 per results page. The ledger lines of the six-city widen (6 demand calls, 52 results pages, all between 18:18 and 18:27 UTC on 2026-10-11) sum to $0.19196. Balance before and after, as reported by the run: $0.6492 to $0.4572; this session made no API call and did not re-check it.

## 4. Verdicts by family

Re-derived from each city's `classified.json` (domain lists as of `d9c5921`). "Before review" re-applies the lists as committed in `8095dd9` to the same saved top-10 results.

| Family | Validated | Open before review | Open after review | Verdict | Median marketplaces in top 10 |
|---|---|---|---|---|---|
| Things to do | 6 | 6 | 6 | Pursue (n = 6, one query per city) | 1.5 |
| Tag (category) | 13 | 12 | 7 | Pursue (53.8%) | 3 |
| Attraction | 27 | 23 | 7 | **Skip** (25.9%) | 4 |
| Best time to visit | 6 | 5 | 1 | **Skip** (16.7%) | 2.5 |

After review, open / validated per city:

| City | Things to do | Tag | Attraction | Best time |
|---|---|---|---|---|
| Kyoto | 1/1 | 2/3 | 1/2 | 0/1 |
| Lisbon | 1/1 | 1/2 | 0/4 | 0/1 |
| Hanoi | 1/1 | 0/0 | 1/3 | 1/1 |
| Rome | 1/1 | 1/4 | 5/13 | 0/1 |
| Bali | 1/1 | 2/2 | 0/0 | 0/1 |
| Bangkok | 1/1 | 1/2 | 0/5 | 0/1 |

The four families add to the 52 validated queries (6 + 13 + 27 + 6).

**The Tag verdict is a knife edge.** It is 7 of 13, so one query decides it, and it moves either way under reasonable alternative readings:

- Return the 15 borderline domains (section 6) to small site: 8/13, Pursue.
- Treat airlines, cruise lines and resort brands as non-small: still 7/13, Pursue.
- Also treat the two small hotel sites that appear (`viehotelbangkok.com`, `natanao1969.com`) as non-small: **6/13 (46.2%), which would be Skip.** The query that flips is "city tours in bangkok", which has exactly 3 small sites and one of them is a hotel.

The Attraction and Best-time Skips do not move under any of these readings (Attraction 7 to 10 of 27 at most; Best time 0 to 2 of 6).

## 5. Reading the verdicts honestly

"Small site" is a catch-all, so "open" can overstate the opportunity: hotels, airlines, cruise lines and apps are in it today because no class fits them. The **Skip verdicts are firm**: they hold even under the most generous reading. The **Pursue verdicts mean "not excluded", not "proven"**. Things to do and Best time have one validated query per city, so the rule's minimum of 5 is met only by pooling the six cities. Hanoi has no validated Tag query and Bali has no validated Attraction query. Multi-family queries do not occur in this run (each validated query belongs to exactly one family), so the family counts add to 52.

### 5b. Limits of the method

- **US-English only.** Volumes come from DataForSEO location 2840, language `en`. `no_data` means no data in that market and language, not no demand. The audience for these cities is international and searches in the UK, Australia, Canada, India, Singapore, the Philippines and in other languages.
- **One market, a 100-a-month floor.** This removes the long tail, which is where small sites usually win.
- **Candidates are seeded from Viator's tags and attractions,** which is what Atlas sells, not what searchers or competitors rank for. This is why only about 9% of candidates validated (52 of 610).
- So these verdicts answer "are these specific query families winnable by a small site under US-English data", not "where should Atlas build". A demand-seeded follow-up (competitor-ranked keywords as seeds, multi-market volumes, a multilingual head-term check) is being planned. It has not been done, and nothing here should be read as if it had.

## 6. The domain review

187 distinct hosts in the top-10 results were unlisted (small site by default) under the committed lists, and all were reviewed one by one. Moves out of small site, which is the only direction the rule allows:

| Result | Hosts |
|---|---|
| Marketplace | 55 |
| Forum or social | 1 (`community.ricksteves.com`) |
| Big publisher or official | 20 hosts (17 listed domains; 3 further subdomains they cover) |
| Stayed small site | 111 |

The `rule.md` changelog tallies this as 55, 1, 17 and 114. The difference is three hosts, `ticketing.colosseo.it`, `bilheteira.parquesdesintra.pt` and `direzionemuseiroma.cultura.gov.it`: the changelog lists them under "left small" as well as under "covered by" a big-publisher parent, and the classifier (and so every number here) treats them as big publisher. This is a documentation tally slip; it does not change any verdict, and `rule.md` was not edited to fix it.

The full per-domain review, with the evidence for each, is in the `rule.md` changelog (entry of 2026-10-12). **This classification is a judgement call.** The 15 borderline calls to look at first, because they move the Tag verdict: `anntours.com`, `crowntours.com`, `italiatours.com`, `italyvacationspecialists.com`, `blacklane.com`, `stpetersbasilica-guide.com`, `aaa.com`, `kiyomizudera.or.jp`, `pantheonrome.it`, `lisboacard.org`, `feelfreetravel.com`, `hawaiidiscount.com`, `contexttravel.com`, `palaciodapena-sintra.com`, `pompeii-online-tickets.com`.

## 7. Provenance and caveats

- The Bangkok pull of 20 September was recorded as predating the commit of `rule.md` by about an hour (the `rule.md` changelog says the rule was fixed before any results page was fetched; this write-up could not settle which from the files). So Bangkok was **re-pulled in full on this run**, whichever is right. Every city's pull is therefore under the committed rule: `8095dd9` is recorded in each `serp.json`. The old September Bangkok data is kept where it was and not used.
- `classified.json` cites `d9c5921` because the domain lists were corrected after the pulls, as the rule's "Allowed change after data arrives" clause allows (lists only, never thresholds). Reclassification was free, from the saved raw responses.
- Between `8095dd9` and `d9c5921`, `rule.md` changed only in its machine-readable domain lists (plus the commas that adding entries needs), one changelog row and the 2026-10-12 review section. The demand floor (100), top N (10), open threshold (3 small sites), minimum validated per family (5) and pursue share (0.5) are identical.
- The local ledger also holds 39 later paid lines from a separate exploratory run. They are excluded from every spend figure here.
- Internal tags that met the 10-product minimum and were therefore filtered out, per city: Kyoto 15, Lisbon 16, Hanoi 15, Rome 16, Bali 15, Bangkok 15 (not all of them would have reached the top 25).

## 8. Rule gaps to consider later (not changed here)

- A class for hotels, airlines and cruise lines, which currently fall into small site and cannot be moved out.
- A `.gov.xx` suffix rule (only `.gov` is matched; `cultura.gov.it` had to be listed by name) and per-country editions of known domains (`tripadvisor.co.uk`, `expedia.ca`).
- How to treat single-attraction affiliate microsites (`stpetersbasilica-guide.com`, `palaciodapena-sintra.com`), which sell one site's tickets and are close to resellers.

## 9. What this means for BRI-205 (provisional)

Not a decision, and subject to the demand-seeded follow-up. Within this supply-seeded, US-English method: destination "things to do" pages and category (tag) pages are not excluded; attraction hubs and best-time pages are excluded. The Tag result is the weaker of the two (section 4). Because Attraction is Skip, the Viator no-index question for attraction pages (BRI-204) no longer blocks anything.

## 10. Cost to scale

Observed cost is about $0.03 per city including a full results-page pull ($0.192 over six cities; range $0.022 to $0.054, highest for Rome, which validated the most queries). For 100 cities that extrapolates to roughly $3. This is an extrapolation, not a measurement: it assumes the same validated share and the same candidate count per city.
