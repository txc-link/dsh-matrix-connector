# Walkthrough — dsh-matrix-connector v0.1.1

**Date:** 2026-08-28
**Author:** dsh-agent (in response to user request to deliver a Matrix
IM adapter for agora central, with deployment end-to end).
**Status:** v0.1.1 code-complete; verification of the deployed
upstream PR + real-Synapse smoke still pending.

## What was built

A Cordis plugin (`dsh-matrix-connector@0.1.1`) that connects a Matrix
homeserver room to agora central. It exposes a `/agora <verb> [args]`
slash command surface and routes requests to agora central's REST
API.

The plugin is the **second** IM entry adapter alongside the existing
`cc-connect` bridge; it follows the same architectural boundary
(§1) — Core does not know IM-specific concepts, the adapter owns
the opaque `threadKey` ↔ `room_id` mapping.

## Files changed (v0.1.1)

| File | Status |
|---|---|
| `package.json` | deps: matrix-js-sdk ^34.13.0, peerDeps: cordis + dsh-agora |
| `dsh.plugin.json` | id `dsh-matrix-connector` |
| `cordis.patch.yml` | row id `matrix-connector` + config defaults |
| `tsconfig.json` + `tsconfig.build.json` | strict + ES2022 + node types |
| `src/config.ts` | `MatrixConnectorConfig` + `buildConfig` |
| `src/matrix-client.ts` | `MatrixTransport` + `MatrixClient` |
| `src/message-router.ts` | `/agora <verb> [args]` parser (7 verbs) + honest HELP_TEXT |
| `src/thread-registry.ts` | `ThreadRegistry` + `buildThreadKey` |
| `src/agora-rest.ts` | typed fetch client — 12 endpoints wired |
| `src/bridges.ts` | CitizenBridge / DispatchBridge / TaskBridge / ArtifactBridge / AttentionBridge — real endpoints |
| `src/index.ts` | `createMatrixConnectorPlugin(opts)` with events polling + auto-edit |
| `tests/*.mjs` | 49 unit tests, all green |
| `tests/smoke-matrix.mjs` | real-Synapse + real-agora smoke (requires env vars) |
| `scripts/provision-bot.sh` | provision a Matrix bot via admin API v2 PUT |
| `README.md` | user-facing installation + commands + rollout checklist |

## Test status

```
$ npm test
ℹ tests 49
ℹ pass 49
ℹ fail 0
```

* `agora-rest.test.mjs`: 8 tests (citizen list / get / pollEvents now real)
* `bridges.test.mjs`: 10 tests (citizen + dispatch + task + artifact + brain)
* `message-router.test.mjs`: 14 tests
* `matrix-client.test.mjs`: 5 tests
* `thread-registry.test.mjs`: 6 tests
* `plugin-flow.test.mjs`: 6 tests (incl. events tick auto-edit)

`smoke-matrix.mjs`: end-to-end against real Synapse + real agora central.
Requires:

```bash
MATRIX_HOMESERVER_URL=https://hs MATRIX_USER_ID=@b:hs \
  MATRIX_ACCESS_TOKEN=… MATRIX_DEVICE_ID=… \
  AGORA_SERVER_URL=http://127.0.0.1:18008 AGORA_API_TOKEN=… \
  node tests/smoke-matrix.mjs
```

## Architectural boundary (§1)

Per §1 of the Agora constitution:

* This plugin is the **only** module that knows both `room_id`
  (matrix) and `threadKey` (agora central adapter-side).
* agora central sees only opaque `task_id` and `state` — never
  `room_id`.
* The matrix homeserver sees only `room_id` and `eventId` — never
  `dispatch_id` or `threadKey`.
* `threadKey` is constructed from `room_id` (`mx_<sha256[0:16]>`) and
  stored only in the plugin-local `ThreadRegistry`.

## Rollout checklist (manual, after this turn)

This plugin assumes agora central has been deployed with the merged
upstream PR `feat/v01-matrix-entry-facade` (commit `c0b46a6` on
master). The dist rebuild and restart cannot be executed from the
DSH agent's bwrap sandbox because the systemd bus is not reachable.
The host user must:

1. `cd /home/ailink/dsh-agora/agora-ts/apps/server && npm run build`
2. `sudo systemctl restart agora.service`
3. `sudo systemctl status agora.service`
4. `curl -fsS -H "Authorization: Bearer $AGORA_API_TOKEN" http://127.0.0.1:18008/api/citizens?project_id=node-a`
5. `curl -fsS -H "Authorization: Bearer $AGORA_API_TOKEN" "http://127.0.0.1:18008/api/events?task_id=any"`

Steps 4 and 5 should both return 200. If they return 404, the
upstream PR has not been picked up; the running node process is
using the old dist. Repeat step 2 and verify with `journalctl -u
agora.service -n 30`.

## Relationship to the upstream PR

The plugin was first scoped against the assumption that all 8 v0.1
endpoints existed on agora central. After probing (turn 31, 32), 3
of them were missing. They were added in upstream PR
`feat/v01-matrix-entry-facade` (commit `c0b46a6`). The plugin was
then updated to use the real endpoints with no shim. There is no
fallback path for un-deployed endpoints; the plugin will fail with
HTTP 404 at runtime until the upstream PR is deployed.

## Acceptance criteria for v0.1.1

This v0.1.1 is considered releasable when:

1. ✅ The plugin compiles (`npm run build`).
2. ✅ All unit tests pass (49/49).
3. ⏳ The upstream PR has been deployed and the citizen/events
   endpoints respond with 200.
4. ⏳ A real-Synapse smoke run completes successfully.

Items 3 and 4 are not part of this turn's deliverable. They are
explicitly tracked in the README "Rollout checklist" section.

## License

Internal — not yet published.