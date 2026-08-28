# dsh-matrix-connector

A Cordis plugin that mirrors agora central state into a Matrix room.

The plugin is an **IM entry adapter** — the second of two parallel
adapters alongside the existing `cc-connect` bridge. It speaks the
Matrix protocol (homeserver + room) on one side and agora central REST
on the other, and keeps an opaque `threadKey` mapping so that neither
side ever has to know the other's identifier.

```
  ┌──────────────────────┐  /agora <verb>  ┌──────────────────────┐
  │  Matrix room user    │ ─────────────► │  dsh-matrix-connector│
  │  (Element / clients) │                │  (this plugin)       │
  └──────────────────────┘                └──────────┬───────────┘
                                                    │  Bearer apiToken
                                                    ▼
                                          ┌──────────────────────┐
                                          │  agora central       │
                                          │  REST :18008         │
                                          └──────────────────────┘
```

## Status: v0.1.1 — code complete (probe 2026-08-28)

This release assumes agora central has been redeployed with upstream
PR `feat/v01-matrix-entry-facade` (commit `c0b46a6` on master), which
adds:

* `GET /api/citizens?project_id=<id>&status=<s>`
* `GET /api/citizens/:citizenId`
* `GET /api/events?task_id=<id>&project_id=<id>&since=<seq>&limit=<n>`
  *(flows `flow_log` + `progress_log` as a join view; no new table)*

All v0.1 verbs are wired through:

| Command | Source | Notes |
|---|---|---|
| `/agora dispatch <prompt>` | `POST /api/tasks` | creates a `quick` task on agora central |
| `/agora task <id> [artifacts]` | `GET /api/tasks/:id` | shows state; optional artifact list |
| `/agora artifact <id>` | `GET /api/artifacts/:id/content` | uploads bytes to matrix |
| `/agora brain search <query>` | `POST /api/projects/:id/context/retrieve` | hybrid brain lookup |
| `/agora citizen list` | `GET /api/citizens?project_id=<id>` | rendered with role + status |
| `/agora citizen show <id>` | `GET /api/citizens/:id` | persona + boundaries + skills |
| `/agora im health` / `help` | `GET /api/health` | static text |
| placeholder auto-edit | `GET /api/events?since=…` (polled) | updates the placeholder message in-place |

## v0.1.1 Verification

* ✅ Unit tests: 49/49 pass (`npm test`).
* ✅ TypeScript build: clean (`npm run build`).
* ✅ **Real-Synapse + real-agora smoke: PASSED on 2026-08-29** (run
  `tests/smoke-matrix.mjs` against `http://8.136.15.147:8008` and
  `http://127.0.0.1:18008`). All five steps return 200 with the
  expected shape. See `docs/10-WALKTHROUGH/2026-08-28-dsh-matrix-connector-v0.1.md`.
* ✅ Production agora central has been deployed with upstream PR
  `feat/v01-matrix-entry-facade` (commit `c0b46a6`) plus the
  composition-wiring fix (commit `ce78b83` on master).

## Architectural Boundary

Per §1 of the Agora constitution:

* This plugin is the **only** module that knows both `room_id`
  (matrix) and `threadKey` (agora central adapter-side).
* agora central sees only opaque `task_id` and `state` — never
  `room_id`.
* The matrix homeserver sees only `room_id` and `eventId` — never
  `dispatch_id` or `threadKey`.
* `threadKey` is constructed from `room_id` (`mx_<sha256[0:16]>`) and
  stored only in the plugin-local `ThreadRegistry`.

## Configuration

The plugin reads its config from the host profile's `cordis.patch.yml`
via the `cordis-define` mechanism. The expected row id is
`matrix-connector`. Defaults:

```yaml
requestTimeoutMs: 10000
commandName: 'agora'
nodeEnabled: true
shareSessionInChannel: false
allowFrom: '*'
autoJoin: true
eventPollIntervalMs: 5000
```

Required environment / config values for one DSH node:

| Key | Meaning |
|---|---|
| `MATRIX_HOMESERVER_URL` | e.g. `http://8.136.15.147:8008` |
| `MATRIX_USER_ID`         | e.g. `@dsh-bridge-node-a:agent-hub.local` |
| `MATRIX_ACCESS_TOKEN`    | bot user access_token |
| `MATRIX_DEVICE_ID`       | bot device id |
| `MATRIX_SERVER_NAME`     | e.g. `agent-hub.local` |
| `DSH_NODE_ID`            | e.g. `node-a` |
| `AGORA_SERVER_URL`       | e.g. `http://127.0.0.1:18008` |
| `AGORA_API_TOKEN`        | dsh-agora profile token (see `cordis.patch.yml` row `id: agora`) |

Use `scripts/provision-bot.sh` to create the bot account on a Synapse
homeserver via the admin API (does not require
`registration_shared_secret` to be enabled; uses `PUT /_synapse/admin/v2/users/<mxid>`).
The script writes the credentials to an env file (mode 0600).

## Files

```
src/
  agora-rest.ts          agora central REST client (typed fetch)
  bridges.ts             CitizenBridge / DispatchBridge / TaskBridge / ArtifactBridge / AttentionBridge
  message-router.ts      /agora <verb> [args] parser
  matrix-client.ts       matrix-js-sdk wrapper
  thread-registry.ts     threadKey ↔ task_id ↔ placeholder bindings
  config.ts              MatrixConnectorConfig + buildConfig with defaults
  index.ts               Cordis plugin entry: createMatrixConnectorPlugin
tests/
  agora-rest.test.mjs    agora-rest unit tests (8)
  bridges.test.mjs       bridges unit tests (10)
  message-router.test.mjs   router unit tests (14)
  matrix-client.test.mjs matrix-client unit tests (5)
  thread-registry.test.mjs  thread registry tests (6)
  plugin-flow.test.mjs   full Cordis plugin apply() flow tests (6)
  smoke-matrix.mjs       end-to-end smoke; requires env vars + real Synapse + real agora central
scripts/
  provision-bot.sh       provision a new bot user on Synapse via admin API
```

## Running tests

```sh
npm install --no-audit --no-fund
npm run build
npm test
```

Expected: `49/49 tests pass`.

## License

Internal — not yet published.