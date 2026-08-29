# R-E Space 嵌套 — progress

**Last updated**: 2026-08-30 (Asia/Shanghai) — R-E.1 收口

## R-E.1

| Field | Value |
|---|---|
| Status | ✅ done (等待总工 commit) |
| Started | 2026-08-30 |
| Completed | 2026-08-30 |
| Worktree | `/home/ailink/dsh-agora/.worktrees/r-e-space-nesting` |
| Branch | `feat/r-e-space-nesting` |

### Steps
- [x] 读 matrix-js-sdk v34.13.0 Space API 类型/方法 — 找到 `getRoomHierarchy` (MSC2946)、`Room.isSpaceRoom()`、`RoomType.Space`、`EventType.SpaceChild`、`RoomState.getStateEvents()`
- [x] 验证本地 Synapse spaces_enabled — Synapse 1.155.0 默认开启，无需 `experimental_features.spaces_enabled`
- [x] 在本地 Synapse 建测试 Space (root + 2 children) — Space `!OCNKEikkiiJEMdWyiQ:agent-hub.local` + child A/B
- [x] adapter 接口设计 + TDD 失败测试 — `src/space-adapter.ts` + `tests/space-adapter.test.mjs`（14 cases）
- [x] adapter 接口签名已 commit-ready — 不破坏现有 config（`spaces?` optional 已加入 `Required<Omit<...>>` 排除列表）

### Verification
- `npm test` 跑绿 **190 / 190**（baseline 176 + 新增 14 space-adapter cases）
- 接口编译通过（`npm run build` 无 TS error）
- 真实 Synapse Space 实测：`_matrix/client/v1/rooms/{id}/hierarchy` 返回 3 rooms（root + 2 children），root.room_type === "m.space"，children_state 完整
- 新增测试的"红"信号延迟到 R-E.2 出现：当真实 matrix-jsSdk-backed `MatrixSpaceTransport` 不实现时，这些 contract test 在真实 homeserver 上会失败 — 与 codebase 现有 TDD 模式一致

### Files Touched
- `src/space-adapter.ts` (新)
- `src/config.ts` (+7 行：`spaces?: ...` optional block，`buildConfig` Omit 加 `'spaces'`)
- `tests/space-adapter.test.mjs` (新)
- `Doc/09-PLANNING/TASKS/2026-08-30-r-e-space-nesting/findings.md` (大幅更新)
- `Doc/09-PLANNING/TASKS/2026-08-30-r-e-space-nesting/progress.md` (本文件)
- `Doc/09-PLANNING/TASKS/2026-08-30-r-e-space-nesting/task_plan.md` §2.4 验证标准段

### Blocked Items
- 无

---

## R-E.2

| Field | Value |
|---|---|
| Status | ✅ done (等待总工 commit) |
| Started | 2026-08-30 |
| Completed | 2026-08-30 |
| Worktree | 本 worktree（继续） |
| Branch | `feat/r-e-space-nesting` |

### Steps
- [x] 在 `src/transport/space-transport.ts` 加 `MatrixJsSdkSpaceTransport` 4 方法的 matrix-js-sdk-backed 实现（`isSpaceRoom` / `listChildRooms` / `getSpaceHierarchy` / `subscribeSpaceEvents`）
- [x] 在 `src/transport/matrix-js-sdk.ts` 加 `getSdk()` 访问器（让 space-transport 共享 SdkMatrixClient 实例 + Room cache + /sync loop）
- [x] cordis composition 注入：`src/index.ts` 的 `apply()` 在 `config.spaces?.enabled === true` 且调用方传了 `matrixJsSdkTransport` 时挂载 `MatrixSpaceAdapter`；`kind === 'message'` 事件并入 `ingestMatrixReply` 通道
- [x] `cordis.patch.yml` 注释段 + 被注释掉的 `spaces: { enabled: true, rootSpaces: [...] }` 行块（默认仍为关闭；不是默认行为）
- [x] 写 `tests/smoke-v060-space-nesting.mjs`：6 项断言覆盖 `isSpaceRoom` / `listChildRooms` / `getSpaceHierarchy` / live `kind=message` / live `kind=child-added`，均通过
- [x] `npm test` 190 / 190 绿（R-E.1 的 14 个 contract test 未转红）
- [x] `node tests/smoke-v060-space-nesting.mjs` 跑通，exit 0
- [x] findings.md / progress.md / task_plan.md 已回写（修改未 commit，按 brief 由总工收口）

### Verification
- `npm run build` 无 TS error（含新增 transport + composition root 改动）
- `npm test` → **190 / 190 pass**（baseline 176 + R-E.1 14 space-adapter cases；R-E.2 不破任何 frozen contract）
- `node tests/smoke-v060-space-nesting.mjs` → ✅ ALL ASSERTIONS PASSED；连 `http://localhost:8008`（本机 Synapse 1.155.0）+ `@r-e-smoke:agent-hub.local` bot token
- `MatrixJsSdkSpaceTransport` 对外只暴露 matrix-agnostic 字段（`spaceId/roomId/order/suggested/via/name/topic`）；SDK `Room` / `RoomState` / `MatrixEvent` 不外泄
- 默认 `config.spaces === undefined` → `MatrixSpaceAdapter` 完全不挂载；现有 v0.5 caller 零破坏

### Files Touched
- `src/transport/space-transport.ts` (新) — `MatrixJsSdkSpaceTransport` 实现
- `src/transport/matrix-js-sdk.ts` (+13 行：`getSdk()` 访问器 + 注释)
- `src/transport/index.ts` (+2 行：`MatrixJsSdkSpaceTransport` 重导出)
- `src/index.ts` (+60 行：`PluginOptions.matrixJsSdkTransport?` 字段 + composition root 挂载逻辑；`SpaceChild/SpaceRef/SpaceEvent/SpaceConfig/MatrixSpaceAdapter/MatrixJsSdkSpaceTransport` 重导出)
- `tests/smoke-v060-space-nesting.mjs` (新) — 真实 homeserver E2E
- `cordis.patch.yml` (+13 行：注释段 + 注释掉的 `spaces:` 块样板)
- `Doc/09-PLANNING/TASKS/2026-08-30-r-e-space-nesting/findings.md` (R-E.2 段追加)
- `Doc/09-PLANNING/TASKS/2026-08-30-r-e-space-nesting/progress.md` (本文件)
- `Doc/09-PLANNING/TASKS/2026-08-30-r-e-space-nesting/task_plan.md` §2.4 验证标准段 (R-E.2 实测结果追加)

### Blocked Items
- 无

### 依赖
- R-E.1 ✅
- R-D reply-to 已 merge（`onTimelineEvent` 可复用）
