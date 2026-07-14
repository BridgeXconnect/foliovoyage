# Atlas — Documentation Index

This folder holds the **three living documents** derived from the [Master Product Specification v1.0](../Travel-Affiliate-Platform-Master-Product-Specification-v1.0.md) (MPS). The MPS remains the umbrella source of truth; these three are the maintainable, day-to-day working documents.

```
Master Product Specification (MPS)  ← umbrella / archival source of truth
        │
        ├── 01 Product Bible ................ WHY the product exists & what it becomes
        │       (Vision · Business · Personas · Journeys · IA · Monetization · Roadmap)
        │
        ├── 02 System Architecture Spec ..... HOW it is built
        │       (Domain · Requirements · APIs · Services · Data · Search · Maps ·
        │        Affiliate · SEO · AI · Security · Performance · Infra · Observability ·
        │        Testing · Analytics · Tech Debt · Appendices)
        │
        └── 03 Engineering Specification ..... WHAT gets built, in what order
                (Milestones → Epics → User Stories → Acceptance Criteria, traced to FR IDs)
```

## The documents

| # | Document | Owns | Derives into |
|---|----------|------|--------------|
| 01 | [Product Bible](01-product-bible.md) | Vision, business, users, UX, roadmap, monetization | Roadmap priorities feeding the Engineering Spec |
| 02 | [System Architecture Specification](02-system-architecture-specification.md) | Domain model, `FR-*`/`NFR-*` requirements, APIs, services, data, infra, security | Technical specs feeding the Engineering Spec |
| 03 | [Engineering Specification](03-engineering-specification.md) | Milestones, epics, user stories, acceptance criteria | GitHub Issues → Pull Requests |

## Traceability rule

Nothing bypasses the hierarchy:

```
Product Bible (goal) ──▶ Architecture (FR-* requirement) ──▶ Engineering (story + acceptance criteria) ──▶ Issue ──▶ PR
```

Every user story in doc 03 links **up** to one or more `FR-*` / `NFR-*` IDs defined in doc 02, and each `FR-*` links up to a Business Goal (`BG-*`) in doc 01.

## Maintenance

- Change a requirement → edit doc 02, bump its ID's note, and update any dependent stories in doc 03.
- Change strategy/scope → edit doc 01, then propagate to 02/03.
- The MPS is updated (Change Log) only for **major** version bumps; the three living docs move continuously.

_Version: 1.0 · 2026-07-05_
