# Scope: already built (Folio Voyage, product name Atlas)

Features that predate the workflow, enrolled for context. `/develop` and `/sync` leave them alone. See the legend in [index.md](index.md#legend) for the status words and the feature lifecycle.

### A. Viator import pipeline and curated cities · existing
Nightly crawl of Viator products for six curated cities, with location and price resolution, quarantine, and an idempotent upsert. It does not fetch attractions or tag names today. code in `apps/api/src/modules/import/`

### B. Hand written destination pages for six cities · existing
Static editorial pages for Bangkok, Kyoto, Hanoi, Rome, Lisbon and Bali, with Viator links attached by a one time match. code in `apps/web/src/data/destinations.ts`
