# packages/shared

## Overview

`@folio/shared` — cross-cutting domain types consumed by both `web` and `api`
via `workspace:*`. No build step (`main`/`types` point at `src/index.ts`
directly); add shared DTOs/types here rather than duplicating them in both apps.

Two kinds of content, kept apart:

- `src/index.ts` — the static-editorial content model (`Experience`,
  `Destination`, ...) that `apps/web`'s hand-authored destinations use.
- `src/api.ts` — the **API wire contract** (BRI-214): Zod schemas plus their
  inferred types for what `apps/api` returns over HTTP (`DestinationResponse`
  today). Re-exported from `index.ts`.

## The wire contract: who uses it how

- **`apps/api`** imports the *types only* (`import type` / `export type ... from`)
  and builds responses to them. Type imports are erased, so the compiled
  CommonJS API never `require`s this ESM-typed package at runtime. Do not
  import a schema *value* into API source; in specs it is fine (ts-jest
  transpiles it), and `destination.service.spec.ts` uses it as the contract check.
- **`apps/web`** parses what it fetches with the schema (`fetchDestination`), so
  a field that drifts fails loudly instead of being cast through.
- Adding or changing a field: edit the schema in `api.ts` once. The API's
  `tsc` and the contract test fail until the response builder matches, and the
  web parse fails until the API is deployed with it. Schemas strip unknown
  fields (API ahead of web is safe) but reject missing/mistyped ones, so
  **ship an additive field API first, web second**; removing a field is the
  reverse.
- Only the destination endpoint is covered because it is the only one the web
  reads live. Search (`apps/api/src/search/search.types.ts`) is still API-local
  until the web's search moves off static data; move it here when it does.
