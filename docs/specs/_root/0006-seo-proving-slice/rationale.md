# 0006. SEO proving slice: rationale

Decision record for [index.md](index.md). Builds do not need this file.

## Context

Atlas needs to learn whether curated Bangkok pages, with visible logic, facts computed across tours and a house voice, can earn search traffic where demand exists and the results page is weak. It must learn this before the site launches, so the test runs with the gate on: only the slice can be crawlable.

The forces:
- **Viator's terms (BRI-204).** No rating or review data in server HTML. Ratings may only act as the yes or no BRI-200 gate. No generated text may state price, availability or cancellation.
- **F1 and the voice guide (`docs/08`).** No per item human edit, and the banned patterns are blocking. Google's 1 Oct 2026 guidance asks for a human fact check of each page.
- **The data.** Bangkok has about 2,590 live tours under ref `343`. Off city tours are filed under that ref alone, 612 have no coordinates, and Viator tags cover far fewer tours than titles do.
- **The stack.** Next.js 15 static rendering, edge middleware (no `fs`), a CommonJS API that cannot `require` the ESM shared package, prod on Neon behind a read only pattern, and the pre deploy migration path for any schema change.

Without a decision the slice either reads live data on request (and can leak ratings), or depends on hand written lists that drift from the gate, the sitemap and the click ledger.

## Options considered

### Option 1: Committed snapshot files and a JSON manifest, one static route

A read only command writes facts and picks to committed JSON. Copy is committed beside it with a grounding hash. A generated live set drives the gate, sitemap, robots and route.

**Pros**: every claim is reviewable in a PR; no request path touches the database; one derivation decides what is live.
**Cons**: two copies of the hash recipe; generated files must be rerun after each command; a facts change needs a copy regeneration.

### Option 2: Database backed pages with ISR

Add slice tables, render from the API, revalidate on a timer.

**Pros**: no generated files; refresh is automatic.
**Cons**: live reads on the request path can leak ratings or prices; ISR is out by the brief; a migration per table; the fact check has nowhere stable to attach.

### Option 3: Hand written pages

Write each page's copy and pick list by hand.

**Pros**: no new tooling.
**Cons**: breaks F1; nothing ties the copy to data; the lists drift from the gate and sitemap.

## Rationale

Option 1 matches each force. Static files mean the BRI-204 rules are checked once, at build, by a leak test over the actual HTML. Hashes tie copy to facts, and the fact check to the exact text Roy read, which turns Google's guidance into something a build can verify. A JSON manifest is the one format both the edge middleware and the CommonJS API can read. Option 2 solves a freshness problem a 12 week test does not have, and Option 3 is ruled out by F1.

Inside Option 1, the choices the interview settled and their runners up are in the index.md Decision table. Three are worth the reasoning here:
- **Campaign column over `referrer`.** Browsers strip or trim referrers, so `referrer` is a hint, not a record. `sessionId` and `providerId` already mean other things. A nullable column is one additive migration.
- **Title patterns alongside tags.** Tags alone would leave the floating markets page with 1 tour.
- **Copy tied to facts, not picks.** Picks change on every refresh, facts rarely. Tying copy to picks would force a regeneration for a tour swap that changes no claim. (Amended 16 Oct 2026: the fact check, unlike the copy, does cover picks, because Roy now judges images in that read. A pick swap needs an approve, never a regeneration.)

## Amendment, 16 Oct 2026: the content research

The content research (`~/folio-logs/seo-content-research/`, synthesis plus four lenses) changed the page design. Roy decided D1 to D10 there; the live session that followed settled the rest. In short:
- **One template (D1).** The research found the strongest trust device a small site can honestly use is a visible rule plus what it left out, and readers choose by need, not by rank. So the rule moves above the fold, a stat strip turns snapshot facts into reader value with no generated text, and picks sit in "How to choose" sections.
- **Per page groups, round robin inside (D2 plus the session).** Roy chose per page groups for the sections (place on floating markets and day trips, dinner and sunset on cruises, a market visit on cooking). D2's round robin across length groups still decides the picks inside each section, so a section never fills from one length group.
- **Rank by distinct keyword groups, not raw count (D2).** Lens 4 found that ordering by raw inclusion count rewards padded lists: the commonest inclusions are "air-conditioned vehicle", "bottled water" and "insurance", so a tour that lists water and insurance outranks one that does not.
- **No numbers in the rule line (D6).** Printing the bar (5 scores, 4.0) or a pass count is review data in server HTML under BRI-204. One clause says what the bar does, never what it is.
- **No personal name (Roy's rule).** The research proposed a named byline and "Notes by Roy"; both were rejected. Everything signed is signed "Folio team", and must be literally true.
- **No map (D8).** The slice reads no coordinates (AC-5).
- **Cooking and cruises are expected weak (D1).** Lens 3 found operator sites and OTA results pages hold those results. They stay in the slice, recorded as expected weak, and are not the quality signal.

### Exceptions to F1 and docs/08

F1 (docs/08) says all content is generated and checked in aggregate, with no per item human edit, and docs/08 says "fact checked" language is not true of anything on the site. This slice records two exceptions, each bounded so it stays true:

1. **The per page fact check.** Roy reads each page before it goes live (Google's 1 Oct 2026 guidance), and `hub-copy:approve` records that read against `checkHash`. Roy never edits the generated text: a page that fails his read fails the calibration (AC-H10), and the fix is the prompt, guide or checks, never the page. The page prints "Checked by the Folio team on {date}" only while `checkHash` still matches, so the claim cannot outlive the check.
2. **Verbatim Local notes (D3).** On floating markets, day trips and temples, a notes file holds short firsthand notes, rendered exactly as written and signed "Folio team" with their date. They are never paraphrased and never seen by the generator, so no generated text claims experience. They never name a tour or operator and never speak of price, availability, cancellation or ratings; `kind` is one of timing, how-to, opinion or warning; `basis` is firsthand. The leak scan and a name check run on them, and they are part of `checkHash`.

docs/08 is not edited in this change. A scoped exception there is a **prerequisite** for scope row 23 and on the scope's "Before launch" list (index.md, Consequences), not a follow up: the pages would otherwise print a line the house rules say is untrue.

**What reads docs/08 today (searched 16 Oct 2026).** Nothing reads, parses or hashes the file. It is cited by hand: `tour-copy-prompt.ts` (header comment: lines 24 and 27 and the BTS calibration example are deliberately left out of the prompt), `tour-copy-check.constants.ts` (the voice counters, citing lines 16 and 17), `tour-copy-check.ts` (the contrastive reveal shapes, citing line 14), and two tests in `tour-copy-prompt.spec.ts` that assert the prompt carries docs/08's banned patterns and never carries "roy", "firsthand" or the BTS example. The golden stamp in `tour-copy-golden-data.ts` hashes the system prompt string, not docs/08. So editing docs/08 changes no test or hash; it can only make those line citations wrong, which is why the exception should be appended, not inserted above line 27.

### Printed counts skip the gate (16 Oct 2026, second amendment)

The planning chat's read: a count of tours that passed the BRI-200 gate (at least 5 reviews, rating at least 4.0) is a count derived from reviews, the same thing D6 keeps out of the rule line. So every printed or generator facing number comes from the printable pool (the AC-M2 pool without the gate), and gated counts stay internal for the floor, the section rule and the picks (index.md AC-9). The cost is a mismatch a reader can notice: a strip may say "of 160" on a page that shows 12 picks from 78 eligible tours. A fixed caption says the counts include tours below the quality bar, with no number. The member counts and shares in the dry runs below are **gated** counts; printable counts are larger (roughly the 15 Oct "Published" column, before the representative tour and image steps) and have not been measured.

### Cross check triage (16 Oct 2026, third pass)

A cross check of the second pass found gaps a builder would have had to fill alone. What changed, and why:

- **No digits in method notes.** "Tours longer than 24 hours" and "takes 2 tours" put numbers next to the sentinel tests and invited exceptions. The words now say "longer than a day" and "takes two tours", and the AC-9 allowance is gone, so the no digit test stays strict. The stats method note drops its date for the same reason; the page already shows `Computed on`.
- **A local preview for the fact check read.** Roy has to read a page before it can go live, but a page renders only once it is live. `seo:preview` runs `next dev` with `SEO_SLICE_PREVIEW=1` and renders any page that has a snapshot and a copy, under a "not approved" banner. It cannot run in a production build or on Vercel, and a test proves it. It replaces `doppler run -- pnpm dev` in AC-H13: the pages need no secrets (checked on 16 Oct 2026, page-template AC-T15), only network access for fonts and Viator images.
- **A stale grounding always fails the build.** It used to be one of the live guard's causes as well, which meant a page could drop out quietly. Now the build fails for every page that is not held and has both files, so the guard never sees it. `seo:index` only warns, because it runs inside `seo:snapshot` before the copy is regenerated.
- **`checkHash` covers every printed manifest string.** Tag names, keyword labels and, on the hub, the listed pages' H1s used to change the page without changing either hash, so Roy's approval could cover words he never read. The Open Graph pick's image URL is in it too, since the stats page has no picks hash.
- **Thin pages are deleted and held.** Writing no new file left the old one in place, so a page under the floor kept serving old facts. The command now deletes the file and exits with an error; the hub is regenerated and approved in the same PR, which the live guard already enforces.
- **Names in attributes and `forbiddenNames`.** A name in an `alt`, `title` or meta tag passed the text scan. The scan now covers attribute values, and Roy's own list of names is scanned everywhere. An empty list fails validation, so the check cannot be skipped by accident. Local notes now pass the first person check too.
- **`eligible.count`.** "Members" now always means printable members; the gated block says `count` and the text says "eligible members", so nobody prints a gated number by reading the wrong field.
- **Stats.** The median is now shown (it was computed and never rendered), `categoryCounts` is gone (nothing rendered it), and a stats page that fails is held so the slice launches without it.

### Pick dry run (prod, read only, 16 Oct 2026)

Guard: `DIRECT_URL` on endpoint `ep-lingering-wildflower-ax1mdc4m` (unpooled), `SET default_transaction_read_only = on`, then `SHOW` returned `on`. Pool: 591 Experiences (representative tour, ref 343, published, BRI-200 gate, image present, AC-M3 exclusions).

| Page | Members | Length groups (under 4h / 4 to 8h / full day / unknown) | First 12, old rule | First 12, round robin | Old picks not in round robin picks |
|---|---|---|---|---|---|
| `floating-markets` | 78 | 1 / 21 / 26 / 30 | 1 / 11 / 0 / 0 | 1 / 4 / 4 / 3 | 9 |
| `temples` | 134 | 20 / 49 / 28 / 37 | 12 / 0 / 0 / 0 | 3 / 3 / 3 / 3 | 11 |
| `day-trips` | 192 | 0 / 39 / 82 / 71 | 0 / 12 / 0 / 0 | 0 / 4 / 4 / 4 | 10 |
| `cooking-classes` | 22 | 16 / 5 / 0 / 1 | 12 / 0 / 0 / 0 | 6 / 5 / 0 / 1 | 6 |
| `cruises` | 55 | 30 / 11 / 9 / 5 | 12 / 0 / 0 / 0 | 3 / 3 / 3 / 3 | 9 |
| `spa-and-massage` (held) | 3 | 2 / 1 / 0 / 0 | same | same | 0 |
| `muay-thai` (held) | 6 | 2 / 2 / 0 / 2 | same | same | 0 |

The old rule filled each live page from a single length group. Member counts match the 15 Oct table exactly. This run predates the per page sections; it confirms the round robin, which now runs inside each section.

Inclusion shares on the same run (the stat strip keeps shares between 20% and 80%): floating markets pickup 56%, meal 22%, entry fee 27%, guide 90%; temples 54%, 12%, 38%, 84%; day trips 58%, 30%, 31%, 86%; cooking 9%, 32%, 0%, 14%; cruises 24%, 58%, 24%, 40%. Guide fails the rule on three pages. Cooking's default set says almost nothing, which is why cooking and cruises get their own keyword sets (AC-S8).

### Group sizes (prod, read only, 16 Oct 2026, title matches among members)

| Page | Group candidates (members whose title matches) |
|---|---|
| `floating-markets` (78) | Maeklong or railway market 26, Damnoen Saduak 19, Ayutthaya 11 |
| `temples` (134) | Grand Palace 52, Wat Arun 28, Wat Pho 26, Ayutthaya 24, tuk tuk 11, walking 8 |
| `day-trips` (192) | Ayutthaya 70, floating market 59, Kanchanaburi 17, Erawan 13 |
| `cooking-classes` (22) | market 11 |
| `cruises` (55) | dinner 27, Chao Phraya 15, Ayutthaya 12, sunset 9 |

Overlaps are real (a Damnoen Saduak tour often also names Maeklong), so a tour goes to the first group it matches, in manifest order.

## Evidence

### Tag versus title coverage (dev, ref 343, before gates)

| Topic | Tag count | Title matches |
|---|---|---|
| Floating markets | Markets 20226: 1 | 203 |
| Temples | Religious Tours 21518: 69 | 372 |
| Muay thai | Boxing Classes 21532: 13, Martial Arts 20227: 5 | 26 |
| Spa | Spas 12078: 32 | 41 |
| Cooking | Cooking Classes 12034: 59 | 56 |
| Cruises | 11885: 80, 21729: 68, 11887: 37, 11963: 30, 11965: 14 | 234 |

Other tags: Day Trips 11889 (563), Multi day Tours 11922 (71), Airport and Hotel Transfers 12044 (307), Private Drivers 20238 (297).

### Off city titles under ref 343 (dev)

Phuket 15, Phi Phi 4, Krabi 2, Pattaya 112 (2 of them floating market tours), Chiang Mai 2. Ayutthaya 285, kept as a real day trip. Of 169 off city title matches, 98 also name Bangkok (for example "Bangkok to Pattaya: Floating Market and Coastal Sights Private Tour"), so a title that names Bangkok is not evidence it stays in Bangkok. Many of the rest are airport transfers to Pattaya, which the transfer tag also catches.

### Eligible members per page (prod, read only, 15 Oct 2026)

Pool: not deleted, ref 343, shared exclusions applied, Experience published. "Eligible" adds the BRI-200 gate (at least 5 reviews, rating at least 4.0).

| Page | Matched | Published | Eligible | 1 to 4 reviews | No reviews |
|---|---|---|---|---|---|
| `cooking-classes` | 56 | 56 | 22 | 13 | 21 |
| `cruises` | 248 | 248 | 55 | 62 | 102 |
| `day-trips` | 453 | 453 | 192 | 103 | 153 |
| `floating-markets` | 171 | 171 | 78 | 37 | 51 |
| `muay-thai` | 24 | 24 | 6 | 10 | 8 |
| `spa-and-massage` | 35 | 35 | 3 | 14 | 17 |
| `temples` | 387 | 387 | 134 | 100 | 151 |

Dev matched within a few rows of prod on every page. The gate, not the rule, is what thins muay thai and spa: most of their tours have under 5 reviews. Widening the title pattern cannot fix that.

### Tours without a Viator link (16 Oct 2026)

`/go/tours/:id` sends a click to the tour's `affiliateUrl` only when `isViatorHost` accepts it (`apps/web/src/lib/viator-url.ts`); otherwise it falls back to Viator's city search page and logs `event=tour_redirect_fallback`. The first draft of AC-R10 listed such picks weekly but left them in, because membership never looked at `affiliateUrl`. AC-M3 now excludes them, using that same function moved to `@folio/shared`, so a refresh drops them like the other stale cases, and the weekly list catches only a URL that changed after the snapshot. The exclusion applies before the gate, so it lowers printable and eligible counts alike. How many Bangkok representative tours it removes was not measured; the first snapshot report shows it, and a page that falls under 10 eligible members is thin like any other. The check runs in apps/api, which today imports only types from the ESM shared package (index.md, Manifest home), so the build confirms `ts-node` can load it before relying on it (AC-M3).

### Data shape notes

- `Tour.inclusions` is an array of `{ type, category, description, typeDescription, categoryDescription }`; every Bangkok tour has at least one.
- `imageAlt` is null on 2,110 of 2,589 Bangkok tours, so the card falls back to the title.
- Every Bangkok `imageUrl` is on `media-cdn.tripadvisor.com` (2,588) or `dynamic-media-cdn.tripadvisor.com` (1), both covered by the existing `remotePatterns`.
- The tour copy check counts voice patterns but does not block on them; hub copy makes them blocking (AC-H3).
- The gateway adapter caps output at 400 tokens; hub copy needs an option for more (AC-H1).
