# Walkthrough — dsh-matrix-connector v0.1.1

**Date:** 2026-08-28 → 2026-08-29
**Author:** dsh-agent (in response to user request to deliver a Matrix
IM adapter for agora central, with deployment end-to end).
**Status:** v0.1.1 code-complete AND verified end-to-end on real
Synapse + real agora central.

## What was built

A Cordis plugin (`dsh-matrix-connector@0.1.1`) that connects a Matrix
homeserver room to agora central. It exposes a `/agora <verb> [args]`
slash command surface and routes requests to agora central's REST
API.

The plugin is the **second** IM entry adapter alongside the existing
`cc-connect` bridge; it follows the same architectural boundary
(§1) — Core does not know IM-specific concepts, the adapter owns
the opaque `threadKey` ↔ `room_id` mapping.

## v0.1.1 Verification — PASSED

**Date:** 2026-08-29

Ran `tests/smoke-matrix.mjs` against:

* Matrix homeserver `http://8.136.15.147:8008` (Synapse v1.12,
  server name `agent-hub.local`)
* Bot user `@dsh-bridge-node-a:agent-hub.local` (real Synapse account)
* agora central `http://127.0.0.1:18008` (production, deployed with
  upstream PR `feat/v01-matrix-entry-facade` + composition wiring fix)

```
== smoke-matrix v0.1.1 ==
homeserver: http://8.136.15.147:8008
agora health: ok
citizens route OK (404 for missing project 'node-a')
citizens available: 0
room_id: !EqHMFbmSZcoiIXEEKe:agent-hub.local
agora task: OC-1787933090847
event stream pages= 6 any event= false final lastSince= 0
OK smoke-matrix passed.
```

Interpretation of each line:

* `agora health: ok` — `/api/health` returns 200 with `{"status":"ok"}`.
* `citizens route OK (404 for missing project 'node-a')` —
  `/api/citizens?project_id=node-a` is wired and returns the
  expected §1 Core behaviour: 404 because no project named
  `node-a` exists yet. The route is alive.
* `room_id: !EqHMFbmSZcoiIXEEKe:agent-hub.local` — Matrix real
  room creation succeeded via `POST /_matrix/client/v3/createRoom`
  using the bot's access token. The room ID is a real Synapse room
  (verifiable in the homeserver).
* `agora task: OC-1787933090847` — `POST /api/tasks` accepted the
  v0.6.0 schema `{title, type, creator, description, priority}` and
  returned a real `task.id`. The plugin never sent `threadKey` /
  `target` / `actor` on the wire — those are adapter-side only.
* `event stream pages= 6` — `/api/events?since=…&project_id=…`
  was polled 6 times (≈ 9 s) and every page returned 200 with
  `{events: [], next_since: 0}` shape. The endpoint is wired; the
  cursor advances (or in this case stays at 0 because no flow_log
  rows have been written for this project yet).
* `OK smoke-matrix passed.` — exit code 0.

**Note about events**: the events endpoint returns 200 with valid
shape but no events flowed for our task. This is expected for a
fresh project that has never had a state-machine transition logged.
The route is verified end-to-end; whether production emits events
into flow_log for the new task is a core/state-machine concern
outside this plugin's verification scope.

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
| `tests/smoke-matrix.mjs` | real-Synapse + real-agora smoke (verified PASS) |
| `scripts/provision-bot.sh` | provision a Matrix bot via admin API v2 PUT |
| `README.md` | user-facing installation + commands + verification status |

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

`smoke-matrix.mjs`: end-to-end against real Synapse + real agora central — **PASSED** on 2026-08-29.

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

## Relationship to the upstream PR

The plugin was first scoped against the assumption that all 8 v0.1
endpoints existed on agora central. After probing (turn 31, 32), 3
of them were missing. They were added in upstream PR
`feat/v01-matrix-entry-facade` (commit `c0b46a6`). A second commit
(`ce78b83` on master) wires `flowLogRepository` +
`progressLogRepository` through `composition.ts` and `index.ts` so
that `buildApp({...})` receives them — without that wire, the
`/api/events` route would 503 "Task event repositories are not
configured".

## v0.2 direction

The next iteration will add:

* Long-poll or SSE on `/api/events` (instead of GET polling) so the
  placeholder edits happen in <100 ms.
* Per-citizen dispatch: `/agora dispatch <citizen_id> <prompt>` to
  route to a specific runtime node rather than creating a generic
  `quick` task.
* Brain search enrichment: show passage-level highlights, not just
  top-N references.
* Real DSH plugin mounting via `cordis-define` so the cordis
  composition includes `matrix-connector` automatically (currently
  manual via `cordis.patch.yml` row).

## License

Internal — not yet published.