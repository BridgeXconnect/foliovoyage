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
- **Copy tied to facts, not picks.** Picks change on every refresh, facts rarely. Tying copy to picks would force a regeneration and a fresh fact check for a tour swap that changes no claim.

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

### Data shape notes

- `Tour.inclusions` is an array of `{ type, category, description, typeDescription, categoryDescription }`; every Bangkok tour has at least one.
- `imageAlt` is null on 2,110 of 2,589 Bangkok tours, so the card falls back to the title.
- Every Bangkok `imageUrl` is on `media-cdn.tripadvisor.com` (2,588) or `dynamic-media-cdn.tripadvisor.com` (1), both covered by the existing `remotePatterns`.
- The tour copy check counts voice patterns but does not block on them; hub copy makes them blocking (AC-H3).
- The gateway adapter caps output at 400 tokens; hub copy needs an option for more (AC-H1).
