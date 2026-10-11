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
      "musement.com",
      "withlocals.com",
      "takemetour.com",
      "guruwalk.com",
      "expresstickets.shop",
      "activities.marriott.com",
      "audleytravel.com",
      "intrepidtravel.com",
      "urbanadventures.com",
      "city-sightseeing.com",
      "thomascook.in",
      "bangkok-floating-market-tour.com",
      "neweuropetours.eu",
      "thethaitourism.com",
      "thailandhighlights.com",
      "enchantingtravels.com",
      "acanela.com",
      "agoda.com",
      "anntours.com",
      "bestpricetravel.com",
      "bigbustours.com",
      "blacklane.com",
      "byfood.com",
      "citywonders.com",
      "city-sightseeing.it",
      "contexttravel.com",
      "crowntours.com",
      "devourtours.com",
      "expedia.ca",
      "feelfreetravel.com",
      "funex.com",
      "gocity.com",
      "gocollette.com",
      "gowithguide.com",
      "hawaiidiscount.com",
      "hop-on-hop-off-bus.com",
      "italiatours.com",
      "italyvacationspecialists.com",
      "jacadatravel.com",
      "jeronimosmonasterytickets.com",
      "kimkim.com",
      "lisboacard.org",
      "museos.com",
      "museumdeals.com",
      "odynovotours.com",
      "orbistickets.com",
      "palaciodapena-sintra.com",
      "pantheonrome.it",
      "pompeii-online-tickets.com",
      "projectexpedition.com",
      "responsibletravel.com",
      "stpetersbasilica-guide.com",
      "strawberrytours.com",
      "thetripguru.com",
      "thevaticantickets.com",
      "tickets-rome.com",
      "ticketstodo.com",
      "tiket.com",
      "tinggly.com",
      "tourradar.com",
      "tourteller.com",
      "travelingspoon.com",
      "travelocity.com",
      "tripadvisor.ca",
      "tripadvisor.co.nz",
      "tripadvisor.co.uk",
      "tripadvisor.com.sg",
      "tripadvisor.ie",
      "wabunka-lux.jp",
      "walksdevour.com",
      "walksofitaly.com"
    ],
    "exceptPaths": {
      "tripadvisor.com": ["/ShowTopic", "/Trip"],
      "tripadvisor.ca": ["/ShowTopic", "/Trip"],
      "tripadvisor.co.nz": ["/ShowTopic", "/Trip"],
      "tripadvisor.co.uk": ["/ShowTopic", "/Trip"],
      "tripadvisor.com.sg": ["/ShowTopic", "/Trip"],
      "tripadvisor.ie": ["/ShowTopic", "/Trip"]
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
      "tiktok.com",
      "community.ricksteves.com"
    ],
    "paths": {
      "tripadvisor.com": ["/ShowTopic", "/Trip"],
      "tripadvisor.ca": ["/ShowTopic", "/Trip"],
      "tripadvisor.co.nz": ["/ShowTopic", "/Trip"],
      "tripadvisor.co.uk": ["/ShowTopic", "/Trip"],
      "tripadvisor.com.sg": ["/ShowTopic", "/Trip"],
      "tripadvisor.ie": ["/ShowTopic", "/Trip"],
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
      "britannica.com",
      "royalgrandpalace.th",
      "travel.usnews.com",
      "aaa.com",
      "castelodesaojorge.pt",
      "cntravellerme.com",
      "colosseo.it",
      "cultura.gov.it",
      "japan.travel",
      "kiyomizudera.or.jp",
      "kyoto.travel",
      "museivaticani.va",
      "museusemonumentos.pt",
      "nhahatmuaroithanglong.vn",
      "pantheonroma.org",
      "parquesdesintra.pt",
      "pompeiisites.org",
      "ricksteves.com",
      "vatican.va",
      "vietnam.travel"
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
| 2026-09-20 | First use of "Allowed change after data arrives", after the Bangkok pull. All 33 domains in `unlisted-domains.csv` were reviewed. 17 moved out of small site, 16 stayed. Each is listed below. | 15 to class 1, 2 to class 3 | Roy asked for the full review. Claude Code judged each domain from the site's own about or footer page. Roy has not reviewed the individual calls. |
| 2026-10-12 | Second use of "Allowed change after data arrives", after the six city widen (kyoto, lisbon, hanoi, rome, bali and a full Bangkok re-pull under this rule). All 187 distinct domains in the six `unlisted-domains.csv` files were reviewed against each site's own homepage (title, description, footer and outbound links; a browser for sites that block scripts, a search for the three Italian government sites that time out from here). 73 moved out of small site, 114 stayed. Nothing was moved into small site. Details below. | 55 to class 1, 1 to class 2, 17 to class 3 | Roy asked for the full domain by domain review. Claude Code judged each domain from the site. Roy has not reviewed the individual calls. |

### Review of 2026-09-20 (Bangkok unlisted domains)

The test applied to each domain: does it clearly belong to class 1, 2 or 3? A site that sells or lists bookable experiences, and is run as a brand across many destinations or by many guides, is class 1. A single local business is not moved, because class 4 names "local operators" and a lone hotel or a lone local tour firm can be beaten by another small site. A domain that fits no class clearly is not moved. Nothing was moved into small site.

Moved to class 1 (marketplace), 15 domains:

| Domain | Why |
| --- | --- |
| `withlocals.com` | Platform that books tours from many local guides |
| `takemetour.com` | Platform that books tours from many local guides across Thailand and Southeast Asia |
| `guruwalk.com` | Platform that books tours from local guides in hundreds of destinations |
| `expresstickets.shop` | Ticket reseller that lists attraction tickets and sends buyers to booking partners |
| `activities.marriott.com` | Hotel brand booking engine for activities |
| `audleytravel.com` | Established multi country tour operator |
| `intrepidtravel.com` | Established multi country tour operator |
| `urbanadventures.com` | Established multi city day tour brand |
| `city-sightseeing.com` | Established multi city sightseeing tour brand |
| `thomascook.in` | Established travel company that sells tours |
| `bangkok-floating-market-tour.com` | Footer says it is crafted by Headout, which is already listed as a marketplace |
| `neweuropetours.eu` | SANDEMANs Tours, an established multi city tour company |
| `thethaitourism.com` | Booking aggregator for attractions, hotels, flights and transfers across Thai destinations |
| `thailandhighlights.com` | Tour company that is part of a larger travel group, in business since 1998 |
| `enchantingtravels.com` | Established multi country tour operator |

Moved to class 3 (big publisher), 2 domains:

| Domain | Why |
| --- | --- |
| `royalgrandpalace.th` | Official site of the Grand Palace, run by the Bureau of the Royal Household |
| `travel.usnews.com` | Travel section of U.S. News, an established media brand |

Reviewed and left as small site, 16 domains:

| Domain | Why |
| --- | --- |
| `dancarndt.wordpress.com`, `goingthewholehogg.com`, `thescribsandnibs.com`, `littlegreybox.net`, `loveandroad.com`, `northabroad.com`, `onestep4ward.com`, `worldtravelfamily.com`, `tripwis.com`, `wheretogoin.net` | Personal or independent travel blogs |
| `bangkokbeyond.com` | Local tour operator based in Bangkok |
| `riverkwairesotel.net`, `solitairebangkok.com`, `viehotelbangkok.com` | Single hotel sites, not booking engines for a chain |
| `citiesonfoot.com` | Platform for user made walking routes. Does not sell bookable tours and fits no class clearly |
| `gpsmycity.com` | Self guided walking tour app. Does not sell bookable tours and fits no class clearly |

Domains are listed exactly as seen in the results, so `activities.marriott.com` and `travel.usnews.com` do not move their parent domains.


### Review of 2026-10-12 (unlisted domains from the six city widen)

Same test as 20 Sep. Class 1 is a site that sells or lists bookable experiences and is a brand across many destinations, or a platform or reseller of other suppliers' inventory. A single local operator selling its own tours is not moved. Editorial guides that only carry affiliate links are not moved. Hotels, airlines and cruise lines fit no class and stay. Class 3 here includes the official site of the attraction or the state body that runs it, following the Grand Palace call of 20 Sep. Country versions of an already listed domain (`tripadvisor.ca` and so on) are separate domains for the classifier, so they are listed; they also get the same forum paths as `tripadvisor.com`.

Moved to class 1 (marketplace), 55 domains:

| Group | Domains | Evidence |
| --- | --- | --- |
| Online travel agencies | `agoda.com`, `expedia.ca`, `travelocity.com`, `tiket.com`, `tripadvisor.ca`, `tripadvisor.co.nz`, `tripadvisor.co.uk`, `tripadvisor.com.sg`, `tripadvisor.ie` | Hotel, flight and activity booking sites, or country editions of `tripadvisor.com` |
| Multi supplier platforms and aggregators | `tourradar.com`, `kimkim.com`, `gowithguide.com`, `byfood.com`, `tourteller.com`, `ticketstodo.com`, `museumdeals.com`, `funex.com`, `orbistickets.com`, `projectexpedition.com`, `hop-on-hop-off-bus.com`, `responsibletravel.com`, `thetripguru.com`, `travelingspoon.com`, `tinggly.com`, `museos.com`, `wabunka-lux.jp`, `lisboacard.org`, `hawaiidiscount.com` | Each homepage books or compares tours, tickets or experiences from many suppliers or hosts (for example byFood, TourRadar, TicketsToDo, TourTeller "compare tours from major travel sites", Tinggly experience gifts, Wabunka run by J-CAT, `hop-on-hop-off-bus.com` powered by isango!) |
| Reseller storefronts | `jeronimosmonasterytickets.com`, `thevaticantickets.com`, `tickets-rome.com`, `pompeii-online-tickets.com`, `palaciodapena-sintra.com`, `stpetersbasilica-guide.com`, `pantheonrome.it` | Single attraction ticket sites that list partner inventory. `jeronimosmonasterytickets.com`, `thevaticantickets.com` and `tickets-rome.com` carry the footer "Headout Inc", the same call as `bangkok-floating-market-tour.com` on 20 Sep. `pompeii-online-tickets.com` compares Tiqets, GetYourGuide and Headout. `pantheonrome.it` is run by Italy Moments |
| Multi destination tour brands | `acanela.com`, `bestpricetravel.com`, `anntours.com`, `citywonders.com`, `crowntours.com`, `devourtours.com`, `walksdevour.com`, `walksofitaly.com`, `contexttravel.com`, `feelfreetravel.com`, `gocollette.com`, `jacadatravel.com`, `odynovotours.com`, `strawberrytours.com`, `italiatours.com`, `italyvacationspecialists.com`, `bigbustours.com`, `gocity.com`, `city-sightseeing.it`, `blacklane.com` | Tour operators or sightseeing brands in many cities or countries (Collette, Walks of Italy, Devour Tours, Big Bus Tours, Go City with 28 destinations, Jacada, Acanela, City Wonders and similar) |

Moved to class 2 (forum or social), 1 domain: `community.ricksteves.com` (Rick Steves Travel Forum). `ricksteves.com` itself moves to class 3.

Moved to class 3 (big publisher or official), 17 domains:

| Domain | Why |
| --- | --- |
| `cntravellerme.com` | Condé Nast Traveller Middle East |
| `ricksteves.com` | Established guidebook and tour brand |
| `japan.travel`, `kyoto.travel`, `vietnam.travel` | Official tourism bodies (JNTO, Kyoto City, Viet Nam national tourism) |
| `colosseo.it` (covers `ticketing.colosseo.it`), `museivaticani.va`, `vatican.va`, `pompeiisites.org`, `parquesdesintra.pt` (covers `bilheteira.parquesdesintra.pt`), `castelodesaojorge.pt`, `museusemonumentos.pt`, `nhahatmuaroithanglong.vn`, `pantheonroma.org`, `kiyomizudera.or.jp` | Official sites of the attraction or the state body that runs it (Colosseum archaeological park, Vatican, Pompeii park, Sintra parks, Lisbon castle, Portuguese museums agency, Thang Long Water Puppet Theatre under the Hanoi culture department, the Pantheon's chapter of canons, Kiyomizu-dera). The last one is a judgement call |
| `cultura.gov.it` (covers `direzionemuseiroma.cultura.gov.it`) | Italian Ministry of Culture. The `.gov` suffix rule does not match `.gov.it`, so it is listed |
| `aaa.com` | American Automobile Association, an established travel and guidebook brand. A judgement call |

Reviewed and left as small site, 114 domains:

| Group | Domains |
| --- | --- |
| Single local operators (one business selling its own tours, drivers or classes) | `bangkokbeyond.com`, `daytoursbangkok.com`, `yourthaiguide.com`, `colosseumtoursinrome.com`, `driverinrome.com`, `greenlinetours.com`, `theromanguy.com`, `vaticanguidedtour.com`, `vatican.museum`, `rometransfersagency.it`, `insidelisbon.com`, `lxgreentour.com`, `tukdreams.pt`, `kyoto-cooking-class.com`, `kyotofreewalkingtour.com`, `kyotosakeexperience.com`, `mai-ko.com`, `cooking-sun.com`, `walkjapan.com`, `hiprivatetours.com`, `baligreentour.com`, `balihiredriver.com`, `baliprivatedrivers.com`, `thebalitravels.com`, `privatedriverinbali.com`, `gorgeousbali.com`, `baliquadbiking.com`, `atvridebali.id`, `halongbaycruises.com.vn`, `halongbaytours.com`, `ninhbinh-tour.com`, `oxalisadventure.com`, `vietnamtravel.com`, `eliteoftheseas.com` |
| Hotels, resorts, airlines and cruise lines (fit no class; cannot be moved) | `dijiwasanctuaries.com`, `natanao1969.com`, `riverkwairesotel.net`, `solitairebangkok.com`, `viehotelbangkok.com`, `vinpearl.com`, `vietnamairlines.com`, `virginaustralia.com`, `royalcaribbean.com` |
| Fit no class clearly (editorial guides with affiliate links, local info sites, apps, shops, one unrelated funeral home) | `citiesonfoot.com`, `shakaguide.com`, `archeoroma.org`, `vicuscaprarius.com`, `bali.com`, `att-japan.net`, `spiritjapan.com`, `rome.info`, `romesite.com`, `rometoolkit.com`, `sintra-portugal.com`, `vaticanmuseumsrome.com`, `thaiwaysmagazine.com`, `pantheonroma.com`, `ticketsrome.com`, `valley-of-the-temples.com` |
| Personal or independent travel blogs and publications | `2aussietravellers.com`, `48hoursineurope.com`, `adventureinyou.com`, `anywhereweroam.com`, `awaygowe.com`, `baliuntold.com`, `bilheteira.parquesdesintra.pt`, `bontraveler.com`, `culturedvoyages.com`, `destinationwellknown.com`, `differentville.com`, `direzionemuseiroma.cultura.gov.it`, `earthtrekkers.com`, `faheyjamestravel.com`, `girlonazebra.com`, `global-gallivanting.com`, `goingawesomeplaces.com`, `gretastravels.com`, `hallaroundtheworld.com`, `indietraveller.co`, `intothebloom.com`, `journeysandjaunts.com`, `jstraveldiaries.com`, `knycxjourneying.com`, `laidbacktrip.com`, `lifepart2andbeyond.com`, `loveandroad.com`, `mamalovesrome.com`, `meganstarr.com`, `mytravellingcircus.com`, `newromantimes.substack.com`, `nothingfamiliar.com`, `oldworlditalian.com`, `onestep4ward.com`, `roaminghistorian.com`, `sugarandstamps.com`, `the-savvytourist.com`, `thecommonwanderer.com`, `theinvisibletourist.com`, `themanduls.com`, `themobileretiree.com`, `theroamingrenegades.com`, `thetravelexpert.ie`, `theworldtravelguy.com`, `ticketing.colosseo.it`, `timetravelturtle.com`, `travellemming.com`, `untolditaly.com`, `wanderwithjo.com`, `wanderwoman.online`, `waylesstravelers.com`, `whyyouwander.com`, `worldawayfromhome.com`, `worldoflina.com`, `yourfriendthenomad.com` |

Judgement calls to look at first, because they move the Tag verdict: `anntours.com`, `crowntours.com`, `italiatours.com`, `italyvacationspecialists.com`, `blacklane.com`, `stpetersbasilica-guide.com`, `aaa.com`, `kiyomizudera.or.jp`, `pantheonrome.it`, `lisboacard.org`, `feelfreetravel.com`, `hawaiidiscount.com`, `contexttravel.com`, `palaciodapena-sintra.com`, `pompeii-online-tickets.com`.
