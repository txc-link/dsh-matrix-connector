# dsh-matrix-connector

A Cordis plugin that mirrors agora central state into a Matrix room.

The plugin is an **IM entry adapter** — the second one of two parallel
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

## Status: v0.1 — Verified against agora central v0.6.0 (probe 2026-08-28)

This plugin is shipped as **v0.1 code-complete** with one explicit gap:

| Capability | Verified? | Notes |
|---|---|---|
| `/agora dispatch <prompt>`                | ✅ unit | creates a `quick` task on agora central |
| `/agora task <id> [artifacts]`            | ✅ unit | reads `GET /api/tasks/:id` |
| `/agora artifact <id>`                    | ✅ unit | uploads bytes to matrix |
| `/agora brain search <query>`             | ✅ unit | uses `POST /api/projects/:id/context/retrieve` |
| `/agora im health` / `help`               | ✅ unit | reads `GET /api/health` |
| `/agora citizen list`                     | ⚠️ **gap** | endpoint merged upstream but not deployed |
| `/agora citizen show <id>`                | ⚠️ **gap** | endpoint merged upstream but not deployed |
| `/agora <verb>` placeholder auto-edit     | ❌ disabled | `GET /api/events` is not deployed; v0.1 does not auto-edit |

The "gap" endpoints are part of the v0.1 scope and are merged upstream
in commit `c0b46a6` on `agora-ts/master` under branch
`feat/v01-matrix-entry-facade`. They are NOT yet deployed on the
running agora central server because the server must be rebuilt and
restarted for the new code to load — and that is not part of this
plugin's lifecycle.

When the upstream server picks up the merged code, the v0.1 plugin
will pick them up automatically (no plugin rebuild required); the
`EndpointNotDeployedError` guard will then become dead code and can
be removed.

## v0.1 Verification

This plugin is shipped with **code-complete status** but **verification incomplete**:

* ✅ Unit tests: 47/47 pass (see `npm test`).
* ✅ TypeScript build: clean (`npm run build`).
* ❌ Real-Synapse smoke: NOT RUN. The smoke script is provided as
  `tests/smoke-matrix.mjs.disabled` — rename to `smoke-matrix.mjs`
  and provide env vars to run against a real Synapse homeserver.
* ❌ Real-agora-central end-to-end: NOT RUN. The plugin was probed
  against `http://127.0.0.1:18008` for endpoint inventory, but no
  end-to-end `/agora dispatch → task created → placeholder received`
  cycle was executed against the running agora central v0.6.0.

Per §1.5 / §4 of the project constitution, this README does not
claim v0.1 is "verified" — only "code-complete".

## Commands

| Command | Behavior |
|---|---|
| `/agora dispatch <prompt>` | Creates a `quick` task on agora central, replies with a placeholder, stores the task_id ↔ room/eventId mapping. |
| `/agora task <id> [artifacts]` | Reads task state (and attached artifacts when asked). |
| `/agora artifact <id>` | Downloads the artifact bytes from agora central and uploads them as an `mxc://` attachment into the matrix room. |
| `/agora brain search <query>` | Calls `POST /api/projects/:id/context/retrieve` with `mode='lookup'`. |
| `/agora im health` | `GET /api/health`. |
| `/agora help` | Renders the help text. |
| `/agora citizen list` | Surfaces the endpoint-not-deployed message. |
| `/agora citizen show <id>` | Surfaces the endpoint-not-deployed message. |

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
  bridges.test.mjs       bridges unit tests (8)
  message-router.test.mjs   router unit tests (14)
  matrix-client.test.mjs matrix-client unit tests (5)
  thread-registry.test.mjs  thread registry tests (6)
  plugin-flow.test.mjs   full Cordis plugin apply() flow tests (5)
  smoke-matrix.mjs.disabled  end-to-end smoke; requires env vars + real Synapse + real agora central
scripts/
  provision-bot.sh       provision a new bot user on Synapse via admin API
```

## Running tests

```sh
npm install --no-audit --no-fund
npm run build
npm test
```

Expected: `47/47 tests pass`.

## License

Internal — not yet published.