# 0001. Hub page validation experiments: rationale

Decision record for [index.md](index.md). Not read during a build.

## Context

BRI-205 wants to design hub page types (things to do, category, attraction, best time and others). The content engine strategy (`docs/superpowers/plans/2026-09-19-content-engine-strategy.md`, sections 1 and 2) says to test two things before building any of them: whether people search for the queries a hub would answer, and whether small sites can rank for them.

The budget is pay per call with a ceiling near 25 dollars a month, and this experiment should stay well under 5. DataForSEO is the chosen provider, but nothing in the repo uses it. It has no env var, no Doppler secret and no code. The only access today is a connector inside the Claude session, which authenticates with a token that belongs to that session.

The database already holds Viator's tag IDs per tour (`Tour.tags`), rating figures and destination refs for the six curated cities, so part of the candidate list is free.

## Options considered

### Option 1: Drive it through the session MCP connector

Run the calls from a chat session using the DataForSEO tools.

**Pros**:
- No code, no credentials to set up.

**Cons**:
- The live results endpoint takes one keyword per request, so 300 pages is 300 tool calls.
- No spend cap, no ledger, no cache, and it cannot be rerun by a script.
- Money can be spent by a typo in a chat.

### Option 2: A script in `apps/api` with Doppler credentials and a spend guard

A CLI that reads the catalog, calls the providers, caps spend, logs cost and caches raw responses.

**Pros**:
- Matches the repo's secrets rule (Doppler, not files) and its CLI pattern (`*.cli.ts`).
- Hard cap, ledger and cache make an accidental large bill hard to cause.
- Reusable for the 100 city case, and the rule can be reapplied to saved data for free.

**Cons**:
- More work than the experiment alone needs.
- Adds two secrets and a folder to `apps/api`.

### Option 3: A throwaway script outside the repo

A one file script run once, with credentials pasted into the shell.

**Pros**:
- Fastest to write.

**Cons**:
- Credentials end up in shell history or a file, against the repo's Doppler rule.
- No guard, and no trail for whoever reruns it later.

## Rationale

Option 2. The force that decides it is the spend risk: with a 25 dollar ceiling and a per keyword price model, the failure to fear is a loop or a mistyped depth, not the cost of the plan itself. A guard that refuses before sending is cheap insurance, and it comes with the cache and ledger the strategy document already assumes ("keep raw results"). Option 1 fails on scale, since one keyword per request makes it impractical, and Option 3 fails the repo's own secrets rule.

Roy chose a one off with raw results kept. The design honors that: nothing is scheduled, and the tool is small, but it keeps the data on disk so a rerun or a new rule costs nothing.

**Premise note**: five decisions and a spend guard is a lot of structure for an experiment that may cost under a dollar. It is defensible because the guard is the part that protects the budget, and the rest are small. If Roy would rather skip a guard, Option 3 with a hand set cap is the lighter path, at the price of the secrets rule.

## Evidence

**DataForSEO facts checked from its documentation (free, no calls made)**:
- Keyword Overview live: up to 700 keywords per task, each at most 80 characters and 10 words, one task per live call. Keywords absent from the database are not charged. Returns search volume, difficulty, intent and backlink figures. `include_serp_info` returns result types and a check URL, not the top 10 domains. `include_clickstream_data` doubles the price. Rate limit 2000 calls a minute.
- SERP organic live regular: one keyword per request, billed per 10 results page, `depth` defaults to 10. Items carry `domain`, `url`, `rank_group` and `type`. Search operators multiply the charge by 5.

**Facts taken from the strategy document, not verified**: Keyword Overview about 0.012 per task plus 0.00012 per keyword; SERP 0.002 live or 0.0006 through the standard queue; about 0.12 for 6 cities of demand and 0.18 to 0.60 for about 300 pages.

**Facts about the repo**: `Tour.tags Int[]` stores Viator tag IDs (`apps/api/prisma/schema.prisma`). `Tour.destinationRefs` and `curated-cities.ts` map tours to the six cities by exact ref. The repo calls only `/products/modified-since`, `/locations/bulk`, `/availability/schedules` and `/exchange-rates`, so `/products/tags` and `/attractions/search` are new calls. Env vars go through `apps/api/src/config/env.validation.ts`.

**Not verified**: whether `/attractions/search` returns a product count or rating; the exact prices; whether the balance call is free.

## References

None (the engineer chose no references for this spec).
