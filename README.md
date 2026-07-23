# Folio Voyage — monorepo

pnpm + [Turborepo](https://turbo.build) workspace for the Atlas travel-affiliate
platform.

```
apps/
  web/     Next.js 15 frontend (the existing app, moved here from ./frontend)
  api/     NestJS API (modular monolith) — HealthModule only so far
packages/
  shared/  @folio/shared — domain types shared by web + api
```

## Prerequisites

- Node **22** (`.nvmrc` → `nvm use`)
- pnpm **11** (`corepack enable` will provide the pinned version)

## Getting started (from a clean clone)

```bash
pnpm install        # install all workspaces
pnpm dev            # runs apps/web + apps/api together via Turbo
```

- Web: http://localhost:3000
- API: http://localhost:3001 — health check: `curl http://localhost:3001/health` → `{"status":"ok"}`

The API port is configurable via the `PORT` env var (defaults to `3001`).

## Common tasks

| Command          | What it does                                  |
| ---------------- | --------------------------------------------- |
| `pnpm dev`       | Run web + api in watch mode (Turbo `dev`)     |
| `pnpm build`     | Build every workspace (Turbo `build`)         |
| `pnpm lint`      | Lint every workspace (Turbo `lint`)           |
| `pnpm typecheck` | Type-check every workspace (Turbo `typecheck`)|

Run a single app with pnpm filters, e.g. `pnpm --filter @folio/web dev` or
`pnpm --filter @folio/api dev`.

## Deployment note (TODO — ST-4 / BRI-99)

The Vercel project **root directory must be re-pointed from `frontend` to
`apps/web`** before the next production deploy, now that the app has moved.
That is deliberately **not** done in this story (ST-1) — it belongs to ST-4
(preview + production deploys). Do not deploy from this branch until ST-4 lands.

## Docs

Product and engineering specs live in [`docs/`](docs/). This monorepo scaffold
implements **ST-1** (BRI-96) of milestone **M0 — Foundations**.
