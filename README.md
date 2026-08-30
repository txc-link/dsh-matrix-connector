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

## Status: v0.3.7 — reversible Space authorization

v0.3.7 recognizes an empty replacement `m.space.child` state as removal even
when Matrix supplies `prevEvent`, immediately unbinding the child room from the
connector security boundary.

## v0.3.6 — reliable Space room discovery

v0.3.6 waits for the initial Matrix sync before reading the joined-room cache
and listens for `m.space.child` changes on `Room.currentState`. Newly added
company rooms therefore enter the configured security boundary without a DSH
restart or a manual `allowedRoomIds` entry.

## v0.3.8 — inline text/Markdown artifact preview

v0.3.8 posts a safe, bounded inline source preview before the downloadable
`m.file` attachment for UTF-8 text artifacts, including Markdown. Binary files
remain attachment-only. This works around Element's lack of a built-in `.md`
attachment viewer while preserving the original artifact bytes.

## v0.3.5 — Element-native artifact files

v0.3.5 sends `/agora artifact <id>` results as standard Matrix `m.file`
messages, so Element renders a normal downloadable file card instead of a raw
`mxc://` URI.

## v0.3.4 — durable task artifact lookup

v0.3.4 makes `/agora task <id> artifacts` query the Core Artifact collection by
`owner_kind=task&owner_ref=<id>` instead of assuming artifacts are embedded in
the task record.

## v0.3.3 — safe team-room command routing

v0.3.3 only sends explicit `/agora` messages through the command router.
Ordinary room conversation is left untouched, so the connector can remain in
team discussion rooms without replying with `unknown command` to every post.

## v0.3.2 — reliable Executive Assistant intake

v0.3.2 keeps runtime node identity separate from the optional Core Project
identity, normalizes `--due` values with explicit timezone offsets, and returns
command failures to the Matrix room instead of leaving a silent bot.

v0.3.1 routes `/agora` commands observed on Space child-room timelines through
the command handler and deduplicates events seen by both Matrix SDK surfaces.
This fixes commands that appeared in Element but produced no connector reply.

v0.3.0 adds a thin Matrix entry for Core-owned organizations, employment,
executive requests, task assignment, and the commitment ledger. Configure
`companyOrganization` with a Core organization id or slug to use concise
commands such as `/agora company` and `/agora assistant ask ...`.

The v0.2 boundary remains intact: one connector instance binds to one Core security domain, keeping
Company/Life/Health/Companion as independent top-level Spaces, consumes durable
proactive relationship initiatives, and sends locally synthesized Matrix
`m.audio` only after information authorization and action-risk assessment.

The Core stores an opaque `delivery_binding_ref`, never a Matrix room id.

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
| `/agora company [show [org] \| list]` | `GET /api/organizations` | durable organization, reporting, and employment view |
| `/agora assistant ask [options] <request>` | `POST /api/organizations/:id/assistant/requests` | creates a Core request, assigned task, and commitment |
| `/agora assistant inbox [status]` | `GET .../assistant/inbox` | durable owner inbox |
| `/agora assistant commitments` | `GET .../assistant/commitments` | commitment ledger |
| `/agora assistant show/reconcile <request_id>` | assistant request routes | inspect or reconcile task outcome |
| `/agora im health` / `help` | `GET /api/health` | static text |
| placeholder auto-edit | `GET /api/events?since=…` (polled) | updates the placeholder message in-place |

## v0.3.0 Verification

* ✅ Unit tests: 225/225 pass (`npm test`).
* ✅ TypeScript build: clean (`npm run build`).
* ✅ **Real-Synapse + real-agora smoke: PASSED on 2026-08-29** (run
  `tests/smoke-matrix.mjs` against `http://8.136.15.147:8008` and
  `http://127.0.0.1:18008`). All five steps return 200 with the
  expected shape. See `docs/10-WALKTHROUGH/2026-08-28-dsh-matrix-connector-v0.1.md`.
* ✅ Production agora central has been deployed with upstream PR
  `feat/v01-matrix-entry-facade` (commit `c0b46a6`) plus the
  composition-wiring fix (commit `ce78b83` on master).
* ✅ Windows SAPI Chinese voice smoke generated a 3.3 second WAV locally.
* ⚠️ 2026-08-30 remote probe: Synapse is reachable (Matrix v1.12), but the
  live Core has not deployed the v0.2 relationship/governance routes yet.
* ⚠️ Public Matrix registration is disabled; protected domains require
  dedicated bot identities provisioned through the Synapse admin API.
* ⚠️ E2EE is intentionally disabled in v0.2.1: matrix-js-sdk@34 on this Node
  runtime only offered an in-memory Rust store, which regenerated conflicting
  one-time keys on restart. Health/sensitive-personal rooms remain deployment-
  blocked until a durable crypto store and key recovery are verified.

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
companyOrganization: 'my-company'
companyProjectId: 'optional-core-project-id'
```

`allowFrom` controls every inbound command and reply. Use `*` to allow all
room members, or a comma-separated list of exact Matrix user IDs such as
`@alice:example.org,@bob:example.org`. An explicitly empty value denies all
senders.

Protected companion instance example (use a dedicated bot credential, never
the Company bot):

```yaml
securityBoundary:
  domainRef: 'domain:companion'
  boundaryKind: 'companion'
  rootSpaceId: '!COMPANION_ROOT:agent-hub.local'
  requireTopLevelRoot: true
  allowedRoomIds:
    - '!COMPANION_PRIVATE:agent-hub.local'
speech:
  enabled: true
  provider: 'windows-sapi'
  voiceName: 'Microsoft Huihui Desktop'
  rate: 0
initiativeDelivery:
  enabled: true
  consumerRef: 'connector:companion-node-b'
  pollIntervalMs: 5000
  bindings:
    'binding:companion-primary': '!COMPANION_PRIVATE:agent-hub.local'
spaces:
  enabled: true
```

Run separate connector rows/instances for Company, Life, Health, and
Companion. Logical EA ownership stays in Core; channel identities and
cryptographic boundaries do not merge.

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
  bridges.ts             Task, company, and executive-assistant REST bridges
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
  reply-wiring.test.mjs  Matrix timeline → ingestMatrixReply wiring tests (3)
  smoke-matrix.mjs       end-to-end smoke; requires env vars + real Synapse + real agora central
scripts/
  provision-bot.sh       provision a new bot user on Synapse via admin API
deploy/
  01-deploy-core.sh      deploy agora-ts server on the core machine (build + token + nohup)
  02-provision-bots.sh   bulk-provision N Synapse bot accounts (node-a.env …)
  03-install-dsh-plugin.sh  per-DSH install: dsh plugin add + cordis.patch.yml row
  04-verify.sh           end-to-end verification (Synapse / agora / token / room round trip)
```

## Deployment (multi-machine, multi-DSH)

Full guide: [`deploy/README.md`](deploy/README.md). Quick start:

```sh
# core machine (once): deploy agora-ts server, generate API token
./deploy/01-deploy-core.sh --core-ip <CORE_IP>

# provision N bot accounts on Synapse (once)
./deploy/02-provision-bots.sh --homeserver http://<CORE_IP>:8008 \
    --admin-token '<root_admin_token>' --nodes 5

# every DSH node (once per node)
./deploy/03-install-dsh-plugin.sh --profile web \
    --homeserver http://<CORE_IP>:8008 \
    --agora-url http://<CORE_IP>:18008 --agora-token '<api_token>' \
    --node-id node-a --env-file node-a.env \
    --connector-src /path/to/dsh-matrix-connector

# verify anywhere
./deploy/04-verify.sh --homeserver http://<CORE_IP>:8008 \
    --agora http://<CORE_IP>:18008 --admin-token '<root_admin_token>'
```

## Running tests

```sh
npm install --no-audit --no-fund
npm run build
npm test
```

Expected: `212/212 tests pass`.

## License

Internal — not yet published.
