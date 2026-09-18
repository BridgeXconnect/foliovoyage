# packages/shared

## Overview

`@folio/shared` — cross-cutting domain types consumed by both `web` and `api`
via `workspace:*`. Type-only package (`main`/`types` point at `src/index.ts`
directly, no build step); add shared DTOs/types here rather than duplicating
them in both apps.
