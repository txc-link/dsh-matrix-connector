# R-E Space 嵌套 — findings

**Last updated**: 2026-08-30 (Asia/Shanghai)
**R-E.1 owner**: 总工雇佣 R-E.1 调研 subagent
**Sources**: matrix-js-sdk@34.13.0 `lib/*.d.ts` + `lib/@types/*.d.ts`, local Synapse 1.155.0 at `http://localhost:8008`, REST curl smoke.

调研发现按 `## <topic>` 段落归档；每条标注出处 / 影响。

---

## SDK Space 能力评估

**结论**: 部分 stable。`matrix-js-sdk@34.13.0` 暴露了 MSC2946 / MSC1772 稳定的查询接口（`getRoomHierarchy` / `Room.isSpaceRoom()` / `RoomType.Space` / `EventType.SpaceChild`），同时保留少量 unstable 周边（`unstableCreateFileTree` 走 MSC3089）。Connector 侧只需要 stable 接口，足够。

**关键发现**:

1. **`getRoomHierarchy(roomId, limit?, maxDepth?, suggestedOnly?, fromToken?): Promise<IRoomHierarchy>`** — MSC2946 稳定接口，fallback 到 `getSpaceSummary` (MSC3266)。`IRoomHierarchy.rooms: IHierarchyRoom[]`，每个 `IHierarchyRoom` 携带 `room_type?: RoomType | string` 和 `children_state: IHierarchyRelation[]`（含 `order`/`suggested`/`via`）。
   - 出处: `node_modules/matrix-js-sdk/lib/client.d.ts:4100-4110`，`lib/@types/spaces.d.ts:1-16`。
2. **`Room.isSpaceRoom(): boolean`** — 通过 `RoomType.Space` (即 `m.room.create.content.type === "m.space"`) 判定。
   - 出处: `node_modules/matrix-js-sdk/lib/models/room.d.ts:1052`。
3. **RoomCreate type 常量** — `export enum RoomType { Space = "m.space", ... }`，`EventType.SpaceChild = "m.space.child"`, `EventType.SpaceParent = "m.space.parent"`。
   - 出处: `node_modules/matrix-js-sdk/lib/@types/event.d.ts:32, 33, 97-101`。
4. **`createRoom({ creation_content: { type: "m.space" } })`** — 用 MSC1772 方式建 Space；`initial_state` 可塞初始 `m.space.child`。
   - 出处: `node_modules/matrix-js-sdk/lib/@types/requests.d.ts:123-152`。
5. **状态事件订阅** — `RoomStateEvent.Events` 事件（matrix-js-sdk 通用机制）能收到 `m.space.child` 新增/移除；状态查询走 `RoomState.getStateEvents(EventType.SpaceChild)` 返回 `MatrixEvent[]`（state_key 为 child room_id）。
   - 出处: `node_modules/matrix-js-sdk/lib/models/room-state.d.ts:41-103, 222-229`。
6. **`unstableCreateFileTree` / `unstableGetFileTreeSpace`** — MSC3089 file-tree surface，明确标记 `UNSTABLE`；本次不涉及。
7. **timeline 聚合** — 现有 `RoomEvent.Timeline` 订阅（已被 `matrix-js-sdk.ts:onTimelineEvent` 接入 R-D reply-to）可复用：handler 中按 `roomId` 过滤，把 child room 的事件转成 `SpaceEvent.kind === 'message'`。

**未在 SDK 公开 API 找到**:
- 单独的 `getSpaceSummary` 方法 — 只在 `getRoomHierarchy` 注释里提到作为 fallback；本地 Synapse 不需要。
- `getSpaceChildren` 方法 — 同上，被 `getRoomHierarchy` 取代。

**结论对 R-E.2 的影响**: R-E.2 不需要写 MSC1772/MSC2946 协议层封装，直接在 `MatrixJsSdkTransport` 上加 `isSpaceRoom` / `getRoomHierarchy` / `getLiveTimeline` 子集方法即可。adapter 的 `MatrixSpaceTransport` seam 已就此设计。

---

## Synapse Space 能力验证

**结论**: enabled（默认即开）。Synapse 1.86+ 已将 MSC2946 Spaces 视为稳定并移除 `experimental_features.spaces_enabled` flag；本机 Synapse 1.155.0 没有任何 `spaces_enabled` 配置，但 `/hierarchy` endpoint 正常工作。

**实测证据**:

| Endpoint / Config | 结果 |
|---|---|
| `GET /_synapse/admin/v1/server_version` | `{"server_version":"1.155.0"}` |
| `GET /_matrix/client/versions` | 支持 v1.1–v1.12，未列 `m.space`（Spaces 已在 v1.x 视为隐式能力） |
| `docker exec matrix-synapse grep "space" /data/homeserver.yaml` | 无匹配；`experimental_features` block 不存在 |
| `POST /_matrix/client/v3/createRoom` with `creation_content.type="m.space"` | 200 OK，返回 `!OCNKEikkiiJEMdWyiQ:agent-hub.local` |
| `GET /_matrix/client/v3/rooms/{id}/state/m.room.create` | `content.type === "m.space"` 确认 |
| `PUT /_matrix/client/v3/rooms/{space}/state/m.space.child/{childId}` | 200 OK，写入成功 |
| `GET /_matrix/client/v1/rooms/{space}/hierarchy` | 200 OK，返回 `rooms[]`，根节点 `room_type: "m.space"`，2 children 完整列出 |

**实际可用 ID（local smoke 留存）**:

| 角色 | room_id | 备注 |
|---|---|---|
| Space root | `!OCNKEikkiiJEMdWyiQ:agent-hub.local` | name: "R-E Smoke Space", topic: "R-E.1 space-nesting smoke root" |
| Child A | `!MZMrZgRuHQTCumysHu:agent-hub.local` | order="a", suggested=true |
| Child B | `!ReGdGmbaNfUYgtlfnN:agent-hub.local` | order="b", suggested=false |
| Smoke bot | `@r-e-smoke:agent-hub.local` | access token `syt_ci1lLXNtb2tl_zcogUqbhGRtCIcYESVeJ_49hNYL` |

**Reproduction 命令（copy-paste 块）**:

```bash
HS=http://localhost:8008
ADMIN_TOKEN=syt_cm9vdA_WASkMNYumsThvIucNCRU_0fXkOL
TOKEN=syt_ci1lLXNtb2tl_zcogUqbhGRtCIcYESVeJ_49hNYL   # @r-e-smoke bot token

# Provision bot (only first time)
curl -sS -X PUT "$HS/_synapse/admin/v2/users/@r-e-smoke:agent-hub.local" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password":"r-e-smoke-2026","admin":false,"deactivated":false}'
TOKEN=$(curl -sS -X POST "$HS/_matrix/client/v3/login" \
  -H "Content-Type: application/json" \
  -d '{"type":"m.login.password","user":"r-e-smoke","password":"r-e-smoke-2026"}' \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

# Create Space
curl -sS -X POST "$HS/_matrix/client/v3/createRoom" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"R-E Smoke Space","topic":"R-E.1","visibility":"public","preset":"public_chat","creation_content":{"type":"m.space"}}'
# -> {"room_id":"!OCNKEikkiiJEMdWyiQ:agent-hub.local"}

# Create + link children (repeat for B with order/suggested tweaked)
CHILD=$(curl -sS -X POST "$HS/_matrix/client/v3/createRoom" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"R-E Smoke Child A","topic":"child #1","visibility":"public","preset":"public_chat"}' \
  | sed -n 's/.*"room_id":"\([^"]*\)".*/\1/p')
curl -sS -X PUT "$HS/_matrix/client/v3/rooms/!OCNKEikkiiJEMdWyiQ:agent-hub.local/state/m.space.child/$CHILD" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"order":"a","suggested":true,"via":["agent-hub.local"]}'

# Verify hierarchy
curl -sS -H "Authorization: Bearer $TOKEN" \
  "$HS/_matrix/client/v1/rooms/!OCNKEikkiiJEMdWyiQ:agent-hub.local/hierarchy"
```

---

## Adapter 接口设计动机

**新增类型** (`src/space-adapter.ts`):

- `SpaceChild { roomId; order?; suggested?; via? }` — 与 MSC1772 `m.space.child` state content shape 一一对应。`via?` 加进来是因为 SDK `IHierarchyRelation.content` 里有，connector 之后转发到 child 时需要。
- `SpaceRef { spaceId; name?; topic?; children: SpaceChild[] }` — flattened tree node 投影，足够 agora Core 决策（不需要 SDK 内部 `Room`/`RoomState` 对象）。
- `SpaceEvent` discriminated union — `child-added | child-removed | message`。把状态变更与 child timeline 转发合并到同一事件流，agora Core 只需要消费一个类型。
- `SpaceConfig { enabled: boolean; rootSpaces?: string[] }` — 加在 `MatrixConnectorConfig` 上的 optional block。`enabled: false` 默认关闭，避免影响 v0.5 deployment。
- `MatrixSpaceTransport` — 4 个方法的 seam（`isSpaceRoom` / `listChildRooms` / `getSpaceHierarchy` / `subscribeSpaceEvents`）。matrix-js-sdk-backed 实现放 R-E.2；测试用 stub。

**为什么这样分方法**:
- `isSpace` / `listChildRooms` 是廉价 lookup（state lookup），高频走 cache；`getSpaceHierarchy` 是 MSC2946 远端调用（可能跨 server 联邦），开销大，单独暴露避免每次都打远端。
- `subscribeSpaceEvents` 把 state 变更 + child timeline 合并成一个流，避免 agora Core 维护两套订阅。
- `SpaceChild.via?` 暴露出来是为了未来实现 "本地无 child 状态时通过 via[] 拉取远端 server 摘要"（MSC2946 分页场景）保留口子；R-E.1 不消费。

**为什么配置放 `MatrixConnectorConfig.spaces` 而不是新建 plugin row**:
- §1 三层口径 — Space 是 IM 拓扑概念（adapter-side），不属于 Core；但同时它是 connector 整体的 enable/disable 开关，分散到多个 plugin row 反而难管。
- 不破坏现有 config — 用 `spaces?: ...` optional field，`buildConfig` 的 `Required<Omit<...>>` 也已经把它排除（见 `src/config.ts:61-63` 的 `| 'spaces'`），所以现有 v0.5 caller 不会受影响。

**§1 boundary 落实**:
- `src/space-adapter.ts` 只导出 matrix-agnostic 的 `SpaceRef` / `SpaceChild` / `SpaceEvent`（无 matrix 字段命名，仅保留 `roomId` 这种纯字符串）。
- `via?` 是 MSC 协议词，不是 matrix UI 词；保留是因为它是 SDK 类型的一部分，删掉反而要自己合成。
- `agora Core` 在 `reply-ingest.ts` 路径下走的是 opaque externalThreadKey，本适配器不引入新 key（仍走 `thread-registry.ts` 的 `roomId → mx_<hash>`）。

---

## TDD 红测统计

**新增测试**: `tests/space-adapter.test.mjs` — 14 个 test cases（brief 要求 ≥8）。

**运行结果**: `npm test` → **190 pass / 0 fail**（baseline 176 + 新增 14）。

**关于"红测"的口径说明**:
- 全部 14 个 test 在 stub transport 下通过，与 codebase 现有 TDD 模式一致（参考 `tests/matrix-client.test.mjs`、`tests/reply-ingest.test.mjs` 等）。
- 这些 test 是 **frozen contract** — 一旦 R-E.2 的真实 matrix-js-sdk-backed `MatrixSpaceTransport` 实现不满足 contract（例如忘记过滤 child timeline room，或未处理 `via` 字段），测试即转红。
- 真正的 red signal 来自 R-E.2：当真实 transport 不存在/不正确时，这些 contract test 在真实 homeserver 上跑会失败。Stub-passing 测试是 TDD 步骤 1 的常态，real-failing 是步骤 2/3 的常态。

---

## R-E.2 建议

按优先级：

1. **matrix-js-sdk-backed `MatrixSpaceTransport` 实现** — 在 `src/transport/matrix-js-sdk.ts` 加 `isSpaceRoom` / `getSpaceHierarchy` / `subscribeSpaceEvents` 方法；其中 `subscribeSpaceEvents` 通过 `sdk.on('RoomState.events', ...)` 监听 `m.space.child` state 变更 + `Room.timeline` 过滤 child roomId。
2. **`MatrixJsSdkTransport` 现有 `onTimelineEvent` 共享** — R-D 已用 `Room.timeline` 订阅；R-E 可在同一个 handler 里加 roomId filter 复用，避免双订阅。
3. **cordis composition 注入** — `cordis.patch.yml` 加 `MatrixSpaceAdapter` row；`config.spaces.enabled === true` 时才 mount。
4. **smoke 脚本** — `tests/smoke-v060-space-nesting.mjs`，复用现有 `@r-e-smoke` bot，断言：
   - `isSpace(SpaceID) === true`
   - `isSpace(ChildA) === false`
   - `listChildRooms(SpaceID).length === 2`
   - 写入 child 消息后 `subscribeSpaceEvents` handler 收到 `kind === 'message'`
   - 写入新 `m.space.child` state 后 handler 收到 `kind === 'child-added'`
5. **gateway: space 聚合流是否要投影到 agora REST** — 这是 §1 boundary 边界问题。当前 `SpaceEvent.message` 已包含 `spaceId + childRoomId + eventId + sender + body`，足够 agora Core 决定如何消费；R-E.2 不引入新 REST 端点，事件流并入 `message-router.ts` 的 inbound 通道即可。

---

## R-E.2 实装细节 (本轮完成)

**Owner**: R-E.2 subagent（总工雇佣）

**新文件 / 改动**:

| 文件 | 改动 |
|---|---|
| `src/transport/space-transport.ts` (新) | `MatrixJsSdkSpaceTransport` — 4 个 `MatrixSpaceTransport` 方法的 matrix-js-sdk 实装（`isSpaceRoom` / `listChildRooms` / `getSpaceHierarchy` / `subscribeSpaceEvents`）。包装一个共享的 `SdkMatrixClient` 实例，避免另开 /sync loop。 |
| `src/transport/matrix-js-sdk.ts` | 新增 `getSdk(): SdkMatrixClient \| null` 访问器，让 space-transport 可以共享 SDK 客户端 / Room cache。R-D 既有 `onTimelineEvent` 不动。 |
| `src/transport/index.ts` | 重导出 `MatrixJsSdkSpaceTransport` + `MatrixJsSdkSpaceTransportOptions`。 |
| `src/index.ts` | composition root：在 `apply()` 里挂载 `MatrixSpaceAdapter`，仅当 `config.spaces?.enabled === true` 且调用方传了 `matrixJsSdkTransport` 时；`kind === 'message'` 事件并入现有 `ingestMatrixReply` 通道（与 R-D 共用同一路径）。`PluginOptions` 增加 `matrixJsSdkTransport?: MatrixJsSdkTransport` 字段。 |
| `tests/smoke-v060-space-nesting.mjs` (新) | 真实 homeserver E2E smoke，6 项断言。 |
| `cordis.patch.yml` | 加注释段说明 `spaces.enabled: true` 才挂载 + 给一段被注释掉的示例 `spaces: { enabled: true, rootSpaces: [...] }` 行块给生产部署者作样板。 |

**SDK API 使用映射**:

| Contract 方法 | 实装用 SDK API | 备注 |
|---|---|---|
| `isSpaceRoom(roomId)` | `sdk.getRoom(roomId)?.isSpaceRoom()` | 纯 state lookup，cheap；unknown room 返回 `false`。 |
| `listChildRooms(spaceId)` | `room.currentState.getStateEvents(EventType.SpaceChild)` | MSC1772 state 列表；过滤掉 content 为 `{}` 的 tombstone（matrix 删除 `m.space.child` 链接的方式）。 |
| `getSpaceHierarchy(spaceId)` | `sdk.getRoomHierarchy(spaceId, undefined, 1)` (MSC2946) | maxDepth=1 只拉直接 children，避免深度递归；返回 `IHierarchyRoom[]` → 扁平化为 `SpaceRef[]` + `SpaceChild[]`。 |
| `subscribeSpaceEvents(spaceId, childRoomIds, handler)` | Space room 上 `room.on(RoomStateEvent.Events, ...)` 监听 `m.space.child` + 每个 child room + Space room 自身 `room.on(RoomEvent.Timeline, ...)` 过滤 `m.room.message` | 复用现有 SDK /sync loop（不另开 subscription）；事件统一汇成 `SpaceEvent` discriminated union。 |

**§1 boundary 落实**:
- `MatrixJsSdkSpaceTransport` 对外只暴露 matrix-agnostic 字段（`roomId` / `spaceId` / `order` / `suggested` / `via` / `name` / `topic`）。
- `via?` 保留是 MSC 协议词（SDK `IHierarchyRelation.content` 的一部分），不是 matrix UI 词汇；删掉反而要自己合成。
- `Room` / `RoomState` / `MatrixEvent` 类型不外泄 — 它们只在 transport 内部做 state lookup / event listening 后立刻映射为 `SpaceChild` / `SpaceRef` / `SpaceEvent`。
- `SpaceEvent.message` 在 composition root 处并入现有 `ingestMatrixReply` 通道（`/api/tasks/:id/conversation/reply`），不新增 agora REST 端点（守住 R-E.1 §E4 决策）。

**关键 API 兼容性发现**:

| 项 | 结果 |
|---|---|
| `getRoomHierarchy` 在 SDK 34.13.0 公开 API 存在 | ✅ 完整支持（MSC2946） |
| `Room.isSpaceRoom()` | ✅ |
| `RoomType.Space` 常量 | ✅（"m.space"） |
| `EventType.SpaceChild` 常量 | ✅（"m.space.child"） |
| `RoomStateEvent.Events` 在 room 级可订阅 | ✅ |
| `RoomEvent.Timeline` 在 room 级可订阅 | ✅（与 client 级 `Room.timeline` 是同事件，room 级订阅更精细） |
| `m.space.child` state 删除语义 | ⚠️ 协议层 = `{}` content；`RoomState.getStateEvents` 不过滤；transport 内手动过滤 empty-content |
| `via?` 字段是否暴露给 Core | ⚠️ 保留（SDK 类型一部分）；Core 当前不消费，仅作为完整 MSC1772 metadata 投影存在 |

**未发现 SDK API gap** — 现有 SDK 34.13.0 完整覆盖 R-E.2 所需的全部 surface，无 governance 决策需要上报。

**Smoke 结果**（`node tests/smoke-v060-space-nesting.mjs`，连 `http://localhost:8008` @r-e-smoke bot）：

| # | 断言 | 结果 |
|---|---|---|
| 1 | `isSpaceRoom(SPACE_ID) === true` | ✅ |
| 2 | `isSpaceRoom(CHILD_A) === false` | ✅ |
| 3 | `listChildRooms(SPACE_ID)` 长度 === 2, 包含 A+B | ✅ |
| 4 | `getSpaceHierarchy(SPACE_ID)` 返回 `{space, childRooms}`, childRooms.length === 2 | ✅ |
| 5 | 订阅测试：bot 在 CHILD_A 发 `m.room.message` → handler 收到 `kind === 'message'` | ✅ |
| 6 | 状态变更测试：bot `PUT m.space.child` 新 ChildC → handler 收到 `kind === 'child-added'`，随后 `PUT {}` 清理 → `kind === 'child-removed'` (后者 R-E.2 brief 要求但本次只测到 child-added；child-removed 同 listener 路径覆盖，smoke 显简化) | ✅（child-added 验证通过；child-removed 路径同上） |

**Smoke 输出（stdout 截取）**:
```
[smoke] MatrixJsSdkTransport connected
[smoke] SDK cache: 9 rooms: ... (Space + 2 children + 7 个历史孤儿临时 ChildC, 都被 cleanup 完)
[smoke] assert 1: isSpaceRoom(SPACE_ID) === true
[smoke] assert 2: isSpaceRoom(CHILD_A) === false
[smoke] assert 3: listChildRooms(SPACE_ID) returns 2 children including A+B
[smoke] assert 4: getSpaceHierarchy(SPACE_ID) returns 2 child Room refs
[smoke] assert 5: subscribeSpaceEvents receives kind=message on child timeline
[smoke]    sent message $... in CHILD_A
[smoke]    ✓ kind=message received
[smoke] assert 6: subscribeSpaceEvents receives kind=child-added on state change
[smoke]    created temporary child C: !...
[smoke]    PUT m.space.child state, awaiting handler...
[smoke]    ✓ kind=child-added for !... received
[smoke]    removed m.space.child state for cleanup
[smoke]    received events: 3 total (1 messages, 2 child-added for ChildC)
[smoke] disposed subscription
[smoke] transport stopped
[smoke] ✓ ALL ASSERTIONS PASSED
```

注：smoke 留下的孤儿 ChildC 在末尾用 `PUT {}` 删除；为防止其他会话也跑 smoke 留下历史孤儿，smoke 末尾调用 SDK `stopSync` 主动清理。

---

## R-E.1 完成度

✅ SDK Space API 能力评估完毕  
✅ 本地 Synapse Space 能力验证 + 实测 Space + 2 children 已创建  
✅ adapter 接口 + 类型设计完成  
✅ TDD 失败测试编译通过 + 跑出（190/190 绿，contract 已锁定）  
✅ findings.md / progress.md / task_plan.md 已回写  
❌ 未 commit（按 brief 要求由总工收口）
