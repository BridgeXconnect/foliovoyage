# 07 — Wire Up Live Viator Data (Basic Access)

**Run this from:** `/Users/roymkhabela/Folio_Voyage/frontend`
**Read first:** `docs/06-viator-api-integration-guide.md` for full API reference and reasoning — this brief is the actionable subset of it.

## Context

You are on Viator's **Basic Access** affiliate tier. The site already has 6 destinations (Bangkok, Kyoto, Hanoi, Bali, Lisbon, Rome), each with 8 hand-written Experience cards in `src/data/destinations.ts`. The `Experience` type in `src/data/types.ts` already has the exact seam designed for this task:

```ts
affiliateUrl?: string;
provider?: "Viator" | "GetYourGuide";
```

Presence of `affiliateUrl` already flips the card CTA from "Coming soon" to a live link (check `ExperienceCard` to confirm current behavior). **This means the UI needs no rebuild.** Your job is populating this field correctly, not redesigning anything.

## Critical rule: match, don't overwrite

The existing `title` and `description` on each Experience are original editorial copy — the reason this site cleared OTA review and the reason the About page can honestly say "independently written." **Do not replace them with Viator's supplier-provided product titles/descriptions.** That would create duplicate content (the same supplier copy appears on viator.com and potentially other affiliate sites) and contradict the site's own editorial promise.

Instead, for each hand-written Experience:
1. Query Viator's `/products/search` for that destination.
2. Find the real product that best matches what the hand-written card describes (fuzzy match on title/keywords — e.g. the Bangkok card "The Grand Palace & Wat Phra Kaew" should match a Viator product about the Grand Palace/Wat Phra Kaew).
3. If a good match exists, attach that product's `productUrl` (verbatim, plus your own `&campaign=` value — see below) as `affiliateUrl`, set `provider: "Viator"`, and optionally update `priceBand`/`duration` if the real data is meaningfully different.
4. **If no good match exists, leave `affiliateUrl` unset.** The card stays "Coming soon" rather than being force-matched to an unrelated product. A wrong match is worse than no match.

## Steps

### 1. API key — server-side only, never in the client bundle

Add `VIATOR_API_KEY` to `.env.example` as a placeholder and to a local `.env.local` (gitignored) with the real key. All Viator API calls must happen in a server context only (Server Components, Route Handlers, or a build/data-fetching script) — never expose this key to client-side code.

### 2. Resolve destination IDs (one-time)

Call `/destinations` (check both this and `/v1/taxonomy/destinations` referenced in the Golden Path guide — confirm which resolves correctly for your access tier) to get Viator's destination hierarchy. Build a lookup for the 6 existing destinations: Bangkok, Kyoto, Hanoi, Bali, Lisbon, Rome → Viator destination ID. Store this mapping somewhere sensible (e.g. a small JSON/TS file) since it won't change often.

### 3. Fetch and match products per destination

For each destination, call `/products/search` filtered by its destination ID. Use the matching approach above to attach `affiliateUrl`/`provider` to existing Experience objects.

Decide the mechanism that fits the existing project conventions — there's already a `scripts/` folder in this project, which suggests a script (e.g. `scripts/fetch-viator-links.ts`) that runs periodically and writes the enrichment data (id → affiliateUrl/provider mapping) to a small file that `destinations-helpers.ts` merges in, rather than fetching live on every request. This avoids needing a database and fits the "cache, don't ingest" guidance in doc 06 (you don't have `/products/modified-since` at this tier).

If you'd rather fetch live with Next.js ISR (ie inside the destination page itself, `revalidate` on a several-hour interval) instead of a script — that's a reasonable alternative. Pick one, don't build both.

### 4. Campaign tracking

Append `&campaign=<destination-slug>-card` (or similar, alphanumeric and dashes only) to each `affiliateUrl` so Roy can see in his Viator dashboard which destination pages are driving clicks. Never modify the `pid`/`mcid`/`medium` parameters Viator already includes in `productUrl` — only add `campaign` on top.

### 5. Leave everything else alone

No database. No booking flow (not applicable — you're an affiliate, not a merchant; booking happens on viator.com). No review display (not available at Basic Access). No changes to page layout, design, or the 6 destinations/cities already built.

## Definition of done

- `VIATOR_API_KEY` is server-side only, documented in `.env.example`, real value in gitignored `.env.local`.
- A destination-slug → Viator-destination-ID mapping exists for all 6 destinations.
- Each Experience with a confident product match now has `affiliateUrl` (real `productUrl` + `&campaign=`) and `provider: "Viator"` set — original title/description untouched.
- Experiences without a confident match are left as-is ("Coming soon" state preserved).
- No regression to existing pages, design, or SSR/indexability.
