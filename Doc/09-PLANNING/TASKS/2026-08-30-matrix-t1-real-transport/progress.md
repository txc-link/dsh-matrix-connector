# T-1 Progress (2026-08-30)

## 状态

✅ **全部完成**

## 验证

- **Unit tests**: 156/156 pass (新增 matrix-transport.test.mjs 6 cases + matrix-client.test.mjs 3 createRoom cases)
- **Real homeserver smoke**: 1/1 pass — connect + createRoom + sendRoomMessage + joinedMembers + stopSync 全链路
- **build**: 0
- **typecheck**: 0

## 关键 E2E 输出

```
✔ smoke: connect to real homeserver and create+send (834ms)
  ├─ createRoom → roomId: !GQcqzowTVMjgkQxsJR:agent-hub.local (well-formed)
  ├─ sendRoomMessage → eventId: $... (well-formed)
  ├─ joinedMembers → 包含 @dsh-bridge-node-a:agent-hub.local
  └─ stopSync → 干净退出 (SyncApi.stop, MatrixRTCSession leave)
duration: 110s (含 matrix-js-sdk /sync 长轮询)
```

## 变更范围

| 文件 | 变更 |
|---|---|
| `src/transport/matrix-js-sdk.ts` | **新增** — MatrixJsSdkTransport 实现 MatrixTransport + createRoom + joinedMembers + isConnected |
| `src/transport/index.ts` | **新增** — `createBotTransport` (默认) + `createAppServiceTransport` (seam 占位) |
| `src/matrix-client.ts` | 扩展 — `MatrixRoomCreator` interface + `MatrixClient.createRoom` (鸭子类型检查) |
| `src/index.ts` | 导出 — MatrixRoomMessage/Receipt/Transport/MatrixRoomCreator/CreateRoomArgs + MatrixJsSdkTransport + factory |
| `tests/matrix-transport.test.mjs` | **新增** — 6 TDD tests |
| `tests/matrix-client.test.mjs` | +3 createRoom tests |
| `tests/smoke-real-homeserver.mjs` | **新增** — 真实 homeserver E2E (受 env 控制) |

## §1 compliance

- MatrixJsSdkTransport 不依赖任何 platform-specific config 写死 (用户传 options)
- factory 暴露 `createBotTransport` + `createAppServiceTransport` 两条 seam (默认 bot)
- E2EE 默认禁用 (turn 118 决策) — `initRustCrypto()` 被调但失败 swallow
- typecheck 0 — 完全 TypeScript strict

## homeserver 配置

- server_name: `agent-hub.local`
- URL (local): `http://localhost:8008`
- bridge user: `@dsh-bridge-node-a:agent-hub.local` (device MZRCFMCQKU)
- access_token: env var (`AGORA_SMOKE_ACCESS_TOKEN`), 不入仓

## 下一步 (R-B 完成, 推荐下一条)

R-C T-1.5: thread ↔ Task 双向 state 投影
- 依赖 R-B ✅ (transport 已就绪)
- 1 PR / 3-4h
- 接 T-0 ThreadSourcePort (R-A ✅) — 真实 homeserver 作为 source

或 R-H T-2 (P3.5-3a scopeAuthResolver worksite 接入), 闭环现有 P3.5-2 borrow CLI

或 R-D T-3 (matrix reply-to → agora inbox/comment), R-E T-4 (Space 嵌套)