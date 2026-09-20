# BRI-206 pursue or skip rule

Fixed on 2026-09-20, before any results page was fetched. Source: spec 0002 in `docs/specs/_root/0001-hub-page-validation/`. Roy's instructions for the Bangkok run (2026-09-20) call it the signed off rule, so the spec's numbers and lists are copied here unchanged.

The `serp` stage refuses to run unless this file is committed and has no local changes. Each results file records the commit hash of this file and the time of its first paid call. Do not edit the numbers or lists below after a pull. The only allowed change is described under "Allowed change after data arrives", and each use goes in the changelog at the bottom.

## Market and demand floor

Google, United States, English (location 2840, language `en`). A query is validated if its monthly search volume is at least 100.

## Four classes

One class per domain, checked in this order. The first match wins. A subdomain counts as its parent (`en.wikipedia.org` is `wikipedia.org`), and a leading `www.` is ignored.

1. **Marketplace**: sites that sell or list bookable experiences. `tripadvisor.com` is a marketplace except on its forum paths, which are class 2.
2. **Forum or social**: user generated discussion and social sites, plus the forum paths of two other sites.
3. **Big publisher**: established media, guidebook and reference brands, and official tourism bodies. Also any `.gov` domain, and any domain whose first label starts with `visit` or `tourism`.
4. **Small site**: everything else. Independent blogs, small guides and local operators.

## Per query

Count the small sites among the top 10 organic results (ranks 1 to 10, result `type` is `organic`, one result per domain, a domain counted once at its best rank). The query is **open** if that count is 3 or more, and **closed** otherwise.

## Per query family

Families are things to do, tag queries, attraction queries and best time to visit. Count the validated queries that have a results page across all cities pulled.

- Fewer than 5 validated queries: **insufficient data**. This is not a skip.
- Otherwise: **pursue** if at least half of the validated queries are open, else **skip**.

Reported but not gating: the median number of marketplaces in the top 10 per family, so a person can see how saturated it is.

## Allowed change after data arrives

After the pull, a person may review `unlisted-domains.csv` and move a domain that clearly belongs to class 1, 2 or 3 out of the small site default. Only in that direction. Moving a domain into small site is not allowed. This limits the damage of a big publisher that was not listed, without letting the data raise the number of open queries.

Every use is added to the changelog below, in the same commit as the list change, and the results are reclassified from the saved raw responses (free).

## Machine readable lists

The classifier reads this block. Keep it valid JSON.

```json
{
  "version": 1,
  "market": { "locationCode": 2840, "languageCode": "en" },
  "demandFloor": 100,
  "topN": 10,
  "openAtSmallSites": 3,
  "minValidatedPerFamily": 5,
  "pursueShare": 0.5,
  "marketplace": {
    "domains": [
      "viator.com",
      "getyourguide.com",
      "klook.com",
      "tripadvisor.com",
      "expedia.com",
      "booking.com",
      "tiqets.com",
      "civitatis.com",
      "headout.com",
      "kkday.com",
      "trip.com",
      "airbnb.com",
      "musement.com"
    ],
    "exceptPaths": {
      "tripadvisor.com": ["/ShowTopic", "/Trip"]
    }
  },
  "forumOrSocial": {
    "domains": [
      "reddit.com",
      "quora.com",
      "youtube.com",
      "pinterest.com",
      "facebook.com",
      "instagram.com",
      "tiktok.com"
    ],
    "paths": {
      "tripadvisor.com": ["/ShowTopic", "/Trip"],
      "lonelyplanet.com": ["/thorntree"]
    }
  },
  "bigPublisher": {
    "domains": [
      "lonelyplanet.com",
      "timeout.com",
      "cntraveler.com",
      "travelandleisure.com",
      "fodors.com",
      "frommers.com",
      "roughguides.com",
      "nationalgeographic.com",
      "nytimes.com",
      "theguardian.com",
      "cnn.com",
      "forbes.com",
      "wikipedia.org",
      "wikivoyage.org",
      "britannica.com"
    ],
    "suffixes": [".gov"],
    "firstLabelPrefixes": ["visit", "tourism"]
  }
}
```

## Changelog

| Date | Change | Domains moved | By |
| --- | --- | --- | --- |
| 2026-09-20 | Rule fixed before any results page was fetched. | none | Written by Claude Code from spec 0002, which Roy's instructions of 2026-09-20 name as the signed off rule |
