# 0001. Search data access and spend guard

Child of [0001 hub page validation](index.md). Supports scope row 1. Acceptance criteria: AC-1 to AC-5 in the umbrella.

## Decision

Call DataForSEO from a repo script with credentials from Doppler, not through the session MCP connector. Put every paid call behind one `SpendGuard`, and every provider request behind one cached `SearchProviderClient`.

## Design

**Where it lives**: `apps/api/src/modules/research/` (plain TypeScript, no Nest module). Files: `spend-guard.ts`, `search-provider.client.ts`, `research.cli.ts`, each with a `*.spec.ts` beside it. Run it as `doppler run -- pnpm --filter @folio/api research:hub <stage> --city <slug>`.

**Client**: HTTP Basic auth with `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD`, base `https://api.dataforseo.com/v3`, sent through `AllowlistFetch` with only that host (plus the Viator host for the tags call) allowed. Confirm the `AllowlistFetch` constructor shape at build time.

**Guard flow for every request**:
1. Build the request, compute `sha256(endpoint + sorted params)`.
2. Cache hit: return the stored response, charge nothing, add no ledger line.
3. Cache miss: estimate the cost from the price table constants.
4. Refuse if `runSpent + estimate > runCap`, or `monthSpent + estimate > 25`. `runCap` is `HUB_RESEARCH_MAX_USD`, default 1, clamped to 5 in code.
5. Dry run (no `--execute`): print the estimate and stop.
6. Send. Read the response `cost`, append one line to `ledger.jsonl`, write the raw response to `cache/`, add to `runSpent`.

**Ledger line**: `{ts, stage, endpoint, keywords, cost, cacheKey}`. Never any header or credential.

**Month total**: sum of ledger lines whose `ts` is in the current calendar month. It only sees this machine, so the provider dashboard remains the source of truth.

**Rationale, inline**: the MCP connector is authenticated by an OAuth token that belongs to the session, so a repo script cannot use it, and the live results endpoint takes one keyword per request, so 300 pages through a chat session would be 300 tool calls. A script with Doppler credentials matches the repo's secrets rule and is reusable for the 100 city case.

**Build tasks**: see umbrella Build plan tasks 1 to 3.
