# 0002. Pursue or skip rule

Child of [0001 hub page validation](index.md). Supports scope row 2. Acceptance criteria: AC-6, AC-11 and AC-12 in the umbrella.

## Decision

Fix the rule and the class lists in a dated file, `docs/research/bri-206/rule.md`, and commit it before any results page is fetched. The text below is the proposed content. It was written before any results data was seen, and it needs Roy's sign off before it is committed.

## The proposed rule

**Market and demand floor**: Google, United States, English (location 2840, language `en`). A query is validated if its monthly search volume is at least 100.

**Four classes** (one per domain, checked in this order, first match wins):
1. **Marketplace**: sites that sell or list bookable experiences. Starting list: `viator.com`, `getyourguide.com`, `klook.com`, `tripadvisor.com` (except forum paths), `expedia.com`, `booking.com`, `tiqets.com`, `civitatis.com`, `headout.com`, `kkday.com`, `trip.com`, `airbnb.com`, `musement.com`.
2. **Forum or social**: user generated discussion and social sites. Starting list: `reddit.com`, `quora.com`, `youtube.com`, `pinterest.com`, `facebook.com`, `instagram.com`, `tiktok.com`, and forum paths on `tripadvisor.com` (`/ShowTopic`, `/Trip`) and `lonelyplanet.com` (`/thorntree`).
3. **Big publisher**: established media, guidebook and reference brands, and official tourism bodies. Starting list: `lonelyplanet.com`, `timeout.com`, `cntraveler.com`, `travelandleisure.com`, `fodors.com`, `frommers.com`, `roughguides.com`, `nationalgeographic.com`, `nytimes.com`, `theguardian.com`, `cnn.com`, `forbes.com`, `wikipedia.org`, `wikivoyage.org`, `britannica.com`, plus any `.gov` domain and any domain starting `visit` or `tourism` in its first label.
4. **Small site**: everything else. Independent blogs, small guides, local operators.

**Per query**: count small sites among the top 10 organic results (ranks 1 to 10, `type` is `organic`, one result per domain, a domain counted once). The query is **open** if the count is 3 or more, otherwise **closed**.

**Per query family** (things to do, tag queries, attraction queries, best time to visit): count validated queries across all cities pulled.
- Fewer than 5 validated queries: **insufficient data** (not a skip).
- Otherwise: **pursue** if at least half of the validated queries are open, else **skip**.

**Reported but not gating**: median marketplace count in the top 10 per family, so a person can see saturation.

## Allowed change after data arrives

One narrow change is allowed, and every use is logged in a changelog at the bottom of `rule.md`. After the pull, a person may review `unlisted-domains.csv` and move a domain that clearly belongs to a class 1 to 3 out of the small site default, only in that direction. Moving a domain into small site is not allowed. This limits the damage of a big publisher I forgot to list, without letting the data raise the number of open queries.

## The commit first gate

`serp` refuses to run unless `rule.md` exists, `git status --porcelain -- docs/research/bri-206/rule.md` is empty, and the last commit touching it is older than now. Each results output records the file's commit hash and the time of the first call. Changes after the pull go in the changelog and produce a new commit, and outputs from before it keep the earlier hash.

**Rationale, inline**: a count of small sites in the top 10 shows that a small site can rank, not that ours will, so the rule is a cheap filter, not a forecast. Fixing the numbers first is the only defense against fitting the rule to the data. The demand floor of 100 and the minimum of 5 queries per family are judgment calls, chosen so a single odd query cannot decide a family.

**Build tasks**: umbrella Build plan task 4.
