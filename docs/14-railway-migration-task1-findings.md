# Railway Migration — Task 1 Empirical Findings

Recorded 2026-09-04, against Railway project `10a94c58-638f-4597-836f-f00d663185fa`
(`striking-smile`), environment `production`
(`1a124cd9-4d95-4c33-af7d-2a261255fb3c`), using a throwaway `traefik/whoami`
service (`migration-empirical-test`, service id `7beec5bb-6159-481a-bfb1-0d51e6ded518`).

## Question 1: Does a Railway service sleep by default (no `sleepApplication` toggle touched)?

- Domain A (Step 2): `migration-empirical-test-production.up.railway.app`
- Pre-idle response (Step 2): `200`, warm/immediate (comparable to the 0.4–0.5s samples recorded below; the service was reachable within the first 15s poll interval after its deploy went `SUCCESS`)
- `get-service-config` sleep field before the idle wait (Step 3): absent entirely — the `deploy` block returned `{"useLegacyStacker":false,"ipv6EgressEnabled":false,"runtime":"V2","multiRegionConfig":{"iad":{"numReplicas":1}}}`, with no `sleepApplication` key present at all (confirms the default, unmodified state)
- Idle duration observed (Step 4): `15.2` minutes with zero inbound/outbound traffic (07:43:51Z → 07:59:04Z UTC, 2026-09-04)
- Post-idle response (Step 4): `200`, `total_time 0.404082s`, `connect_time 0.085111s` — a second warm sample taken shortly after (08:00:22Z) measured `200`, `total_time 0.485648s`, `connect_time 0.151300s`. Both are ordinary network-latency figures with no cold-start signature (no multi-second delay, no initial `502`).
- `get-status` deployment history (Step 5): `list-deployments` for this service showed exactly two entries — the original deploy (`5e6ca2bd...`, created 07:25:43Z, later `REMOVED` when superseded) and the `PORT=80` fix redeploy (`846bc914...`, created 07:43:22Z, `SUCCESS`). No new deployment, restart, or replica-cycling event appears anywhere between 07:43:22Z and 07:59:04Z (the full idle window) — the same deployment stayed active throughout.
- **Conclusion: Railway services are always-on by default with the sleep toggle untouched.**

## Question 2: Is the generated `*.up.railway.app` domain stable across a redeploy?

- Domain A (Step 2): `migration-empirical-test-production.up.railway.app` (domain id `36dcbe05-4522-4ee6-8b26-455a0afa82a5`)
- Domain B, after `redeploy` (Step 6): `migration-empirical-test-production.up.railway.app` (domain id `36dcbe05-4522-4ee6-8b26-455a0afa82a5`) — character-for-character identical, including the domain record's own id
- **Conclusion: the generated domain is stable across a redeploy.**

## Downstream impact

- Task 6 (BRI-173 removal): Question 1's finding directly supports removing BRI-173's external wake trigger + self-heartbeat — that mechanism exists specifically to counteract Render's free-tier auto-sleep-after-15-minutes-idle behavior, and Railway does not exhibit that behavior by default (confirmed empirically, not just from docs). Task 6 should proceed with removal, contingent on Roy's review of this finding.
- Task 7 (`apps/web` `API_BASE_URL`): Question 2's finding means `apps/web`'s `API_BASE_URL` can be pointed at the real `@folio/api` service's generated `*.up.railway.app` domain once Task 9 creates it, without needing a custom domain or any redeploy-triggered URL-stability workaround — the URL will not change across ordinary redeploys.

## Additional finding: `targetPort` / `PORT` env var (not in the original two questions, but blocking and load-bearing)

The throwaway service was initially unreachable (`502 Bad Gateway`, Railway's HTTP proxy logs showing `"connection refused"` against the running container) even though the container's own deploy logs confirmed it started successfully ("Starting up on port 80"). Root cause: `generate-domain` was called without a `targetPort` argument, and Railway's proxy resolves which container port to route to via the `PORT` environment variable it expects the app to read — `traefik/whoami` doesn't read `$PORT` and is hardcoded to listen on `80`, so with no `PORT` var set, the proxy and the container's actual listening port never matched. Setting `PORT=80` explicitly (`set-variables`, which triggered an automatic redeploy) fixed it immediately; the domain record's own `targetPort` field stayed `null` throughout (routing is driven by the `PORT` env var, not a per-domain target-port setting, for a single-port service).

**Verified for `@folio/api` (checked 2026-09-04):** `apps/api/src/main.ts:22-24` already reads `port` from `ConfigService.get("PORT", ...)` and calls `app.listen(port)` — it does not hardcode a port, so the real `@folio/api` service will not hit this failure mode as long as Railway's injected `PORT` env var reaches the container (the default Railway behavior; no action needed).
