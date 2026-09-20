# 0003. Candidate list from the catalog

Child of [0001 hub page validation](index.md). Supports scope row 3. Acceptance criteria: AC-7 and AC-8 in the umbrella.

## Decision

Build candidates from what is already in the database, plus two cheap Viator calls (tag names, and attractions if they carry counts). No search provider calls at this stage.

## Design

**Tags (free from the database)**: for one city, read `Tour` rows where `deletedAt` is null and `destinationRefs` overlaps that city's `viatorRefs` from `curated-cities.ts`. Group by `unnest(tags)`, computing product count and a rating figure (mean of `ratingAvg` over tours with `ratingCount` of at least 5). Keep tags with at least 10 products, order by product count then rating, take the top 25. Tag IDs become names from `viator/tags.json`, one `/products/tags` call, cached.

**Attractions**: call `/attractions/search` per destination ref, cached in `viator/attractions-<ref>.json`. If a response carries a product count or rating, rank by count then rating. If it carries neither, rank by the number of the city's tours whose `title` contains the attraction name (case insensitive), which is free and deterministic. Keep attractions with at least 5 matching products, top 25. Which of the two applies is unknown until the spike (Follow-up in the umbrella).

**Query templates** (the families):
| Family | Template | Inputs |
|---|---|---|
| `things_to_do` | `things to do in {city}` | city |
| `tag` | `{tag} in {city}`, `best {tag} in {city}` | top tags |
| `attraction` | `{attraction} tickets`, `{attraction} tours` | top attractions |
| `best_time` | `best time to visit {city}` | city |

All text lowercased and trimmed. A query over 80 characters or 10 words is dropped and listed in a `dropped` array with the reason. Duplicates are merged and keep every family label.

**Output**: `candidates.json` and `.csv`, one row per query: `query, family, source (tag or attraction or city), productCount, ratingAvg, rank`. Same inputs give the same order (AC-8), with ties broken by name.

**Value sourcing**: see the umbrella table. Every number on a candidate row comes from a `Tour` column, a Viator response, or a constant in this file.

**Rationale, inline**: `Tour.tags` already holds Viator's tag IDs for every imported tour (about 30 thousand rows, though mostly outside the six cities), so tag counts cost nothing and match what we can really sell. Attractions are the page type with the least known data, so the plan keeps a free fallback rather than blocking on the spike.

**Build tasks**: umbrella Build plan tasks 5 (three hand picked queries) and 6 (the full ranking).
