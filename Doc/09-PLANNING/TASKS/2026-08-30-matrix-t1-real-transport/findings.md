# T-1 Findings (2026-08-30)

## 1. matrix-connector 仓 v0.4.0 surface (turn 120 修正)

turn 116 盘点错误地把 `MatrixTransport.createRoom` 描述为 "stub"。实际 v0.1 已有:
- `MatrixTransport` interface 含 `sendRoomMessage/editRoomMessage/uploadBytes/startSync/stopSync/joinedMembers`
- `MatrixClient` wrapper 已存在 (93 行)
- `matrix-js-sdk@^34.13.0` 已声明为 dep 但 **未实际 install** (这是 turn 120 第一次 npm install)

**真正缺口**:
- `MatrixTransport` 没有 `createRoom` 实现 — R4 Room auto-create 现在靠 stub transport
- 所有测试用 stub transport — 没有真实 homeserver 接入路径
- 没有 factory (bot vs app-service)

## 2. matrix-js-sdk@34 API 关键点

- `createClient({ baseUrl, accessToken, userId, deviceId })` from `matrix-js-sdk` 模块 — access_token 登录
- `sdk.startClient({ initialSyncLimit: 0 })` 启 /sync
- `sdk.createRoom(options)` → `{ room_id }`
- `sdk.sendEvent(roomId, 'm.room.message', content)` → `{ event_id }`
- `sdk.uploadContent(buf, { type, name })` → `{ content_uri }` for attachments
- `sdk.stopClient()` 停 /sync
- `room.getMembersWithMembership('join')` → joined userIds

**TS 类型挑战**:
- `FileType = XMLHttpRequestBodyInit` — Uint8Array 与之不兼容 (TS25 严格区分 SharedArrayBuffer vs ArrayBuffer)
- 修法: 转 `Buffer.from(bytes)` (node 原生)
- `createRoom` options 的 `visibility` 是 sdk 自有 `Visibility` enum (含 'public'/'private'), 不是 string union
- 修法: import `type Visibility, type Preset` from `matrix-js-sdk`

## 3. E2EE 集成

- `sdk.initRustCrypto()` 在 sdk34 types 里**有**声明, 但需要 wasm binary, 实际运行可能失败
- 修法: optional call + swallow — 不阻塞非加密 room
- turn 118 用户决定默认禁用 E2EE, 所以失败 swallow 是正确行为

## 4. homeserver 配置 (turn 120 实测)

- synapse 1.155.0 + postgres 16, 容器 `matrix-synapse` / `matrix-pg`
- server_name: `agent-hub.local`
- registration 关闭 — 必须 admin 创建 user
- 已有 admin users: root + agent1-10 + 2 个 bridge node (`dsh-bridge-node-a/c`)
- `dsh-bridge-node-a` 已绑 device MZRCFMCQKU — **明显是为 matrix-connector 准备的 bridge user**
- access_token 长 55 字符, `syt_` 前缀 (synapse 标准 JWT)
- URL (本地): `http://localhost:8008`
- well-known 暴露 `https://agent-hub.local:18443/`

## 5. 沙箱 / IO 注意

- dsh-matrix-connector 仓 clone 到 `/home/ailink/dsh-agora/.repos/dsh-matrix-connector` (因为 `/home/ailink/` 是 EROFS, 但 `.repos/` 子目录 bind mount 可写)
- npm install 用本地 `.npm-cache` (避免污染主仓)
- smoke 测试用 `AGORA_SMOKE_*` env 控制 — 默认 skip, CI 不需要真实 homeserver
- matrix-js-sdk /sync 长轮询让 smoke duration ~110s (1 次 sync 周期)

## 6. test framework

- 仓用 `node --test` (不用 vitest) — 与 dsh-agora monorepo 区分
- 测试结构: `tests/*.test.mjs` 命名约定
- `npm test` 跑 `npm run build && node --test tests/*.test.mjs`

## 7. 未决事项 (留后续段)

- ❌ E2EE 真正启用 (T-7) — 现 skip crypto
- ❌ app-service 真实注册 (T-10) — 现 placeholder
- ❌ thread ↔ Task 双向 state 投影 (T-1.5 / R-C) — 依赖本 PR transport
- ❌ homeserver 配置管理 (per-project bridge credentials) — turn 118 #5 决策