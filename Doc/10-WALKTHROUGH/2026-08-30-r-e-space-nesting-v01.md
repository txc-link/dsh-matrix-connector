# Walkthrough — R-E Space 嵌套 v0.1 (R-E.1 完成)

**Date**: 2026-08-30 (Asia/Shanghai)
**Phase**: 3 (matrix-connector Space nesting)
**Branch**: `feat/r-e-space-nesting` (worktree `/home/ailink/dsh-agora/.worktrees/r-e-space-nesting`)
**Author**: 总工 + R-E.1 调研 subagent
**Status**: R-E.1 ✅ done (190/190 green) / R-E.2 ⏳ next

---

## 1. TL;DR

- **SDK 风险解除**: matrix-js-sdk@34.13.0 暴露的 Space API（MSC2946 `getRoomHierarchy` / `Room.isSpaceRoom()` / `RoomType.Space` / `EventType.SpaceChild`）**部分 stable 且足够**，R-E 不需要写协议层封装。
- **Synapse 默认 Space enabled**（v1.86+ 移除 `experimental_features.spaces_enabled` flag），本机 1.155.0 验证通过。
- **adapter 接口设计完成**：`MatrixSpaceAdapter` 4 方法 + `MatrixSpaceTransport` seam + `SpaceConfig` opt-in，对现有 v0.5 config **零破坏**（`buildConfig` 的 `Required<Omit<...>>` 已排除 `spaces`）。
- **§1 boundary 落实**：不引入 matrix 词到 Core，事件流仍走 `thread-registry.ts` 的 `roomId → mx_<hash>` opaque 路径。
- **不新增 agora REST 端点**（R-E.2 决策）：`SpaceEvent.message` 并入 `message-router.ts` 现有 inbound 通道。

## 2. Files changed

| File | Status | Purpose |
|---|---|---|
| `src/space-adapter.ts` | new (173 lines) | `SpaceRef` / `SpaceChild` / `SpaceEvent` 类型 + `MatrixSpaceAdapter` + `MatrixSpaceTransport` seam |
| `tests/space-adapter.test.mjs` | new (14 cases) | frozen contract; stub transport 全绿 |
| `src/config.ts` | modified (+12 lines) | `MatrixConnectorConfig.spaces?: SpaceConfig` + `buildConfig` Omit 排除 |
| `Doc/09-PLANNING/TASKS/2026-08-30-r-e-space-nesting/task_plan.md` | new | 总工排期 + R-E.1 详细计划 + R-E.2 依赖 |
| `Doc/09-PLANNING/TASKS/2026-08-30-r-e-space-nesting/findings.md` | new (167 lines) | SDK 评估 / Synapse 验证 / adapter 动机 / TDD 统计 / R-E.2 建议 |
| `Doc/09-PLANNING/TASKS/2026-08-30-r-e-space-nesting/progress.md` | new | R-E.1 步骤全勾 + Verification 段 |
| `Doc/10-WALKTHROUGH/2026-08-30-r-e-space-nesting-v01.md` | new (本文) | R-E.1 完成总结 |

`package.json` / `package-lock.json` **未改**（避免无关 dev-dep drift）。

## 3. Local Synapse Space 实测 (R-E.1 留存)

| 角色 | room_id | 备注 |
|---|---|---|
| Space root | `!OCNKEikkiiJEMdWyiQ:agent-hub.local` | name: "R-E Smoke Space", `m.room.create.type=m.space` |
| Child A | `!MZMrZgRuHQTCumysHu:agent-hub.local` | order="a", suggested=true |
| Child B | `!ReGdGmbaNfUYgtlfnN:agent-hub.local` | order="b", suggested=false |
| Smoke bot | `@r-e-smoke:agent-hub.local` | access token 在 `findings.md` §Synapse 段 (R-E.1 留存, 不再 commit 进仓) |

完整复制命令见 `Doc/09-PLANNING/TASKS/2026-08-30-r-e-space-nesting/findings.md` "Synapse Space 能力验证" 段。

## 4. Architecture decisions locked (R-E.1)

| ID | Decision | Why |
|---|---|---|
| **E1** | R-E = connector 侧 Space adapter, 不动 agora Core | §1 三层口径 — Space 是 IM 拓扑, 属于 adapter 范畴 |
| **E2** | `SpaceConfig` opt-in 默认 `enabled: false` | 不破坏现有 v0.5 deployment; `buildConfig` `Required<Omit<...,'spaces'>>` 已排除 |
| **E3** | `MatrixSpaceTransport` seam + stub 测试 | host 测试无需 homeserver; R-E.2 在同一 contract 上加 SDK 实现 |
| **E4** | 不新增 agora REST 端点 | `SpaceEvent.message` 字段已含 `spaceId + childRoomId + eventId + sender + body`, 足够 Core 消费; 并入 `message-router.ts` 现有 inbound 通道 |
| **E5** | `SpaceEvent` 用 discriminated union 合并 state 变更 + child timeline | Core 只需订阅一个流, 避免维护两套订阅 |

## 5. Verification

- `npm test` → **190 pass / 0 fail** (baseline 176 + 新增 14)
- contract test 在 stub transport 下全绿 → **frozen contract 已锁定**
- 真实 red signal 来自 R-E.2: 当 matrix-jsSdk-backed `MatrixSpaceTransport` 不实现或实现错误, contract test 在真实 homeserver 上跑会失败
- 端到端冒烟 (R-E.2): `@r-e-smoke` bot + Space + 2 children 留存, R-E.2 subagent 直接用

## 6. R-E.2 — 接下来做什么

| Step | File | Outcome |
|---|---|---|
| 1 | `src/transport/matrix-js-sdk.ts` | 加 `MatrixSpaceTransport` 4 方法 SDK 实现 (复用 `Room.timeline` handler 加 roomId filter) |
| 2 | `src/composition.ts` + `cordis.patch.yml` | `MatrixSpaceAdapter` row, `config.spaces.enabled === true` 才 mount |
| 3 | `tests/smoke-v060-space-nesting.mjs` | 真实 homeserver smoke: isSpace / listChildRooms / hierarchy / 写 child 消息触发 subscribe / 写 m.space.child state 触发 child-added |

## 7. Cross-references

- **SSoT phase 3**: `Doc/Agora-实施排期-dsh-matrix-connector.md` §9
- **task_dir**: `Doc/09-PLANNING/TASKS/2026-08-30-r-e-space-nesting/`
- **findings**: `Doc/09-PLANNING/TASKS/2026-08-30-r-e-space-nesting/findings.md`
- **agora-ts SSoT**: `dsh-agora/Doc/Agora-实施排期-Agora-TS.md` §4 (本阶段 agora-ts 不动)
- **AGENTS.md §1**: adapter 不动 Core
- **AGENTS.md §3**: SSoT ↔ planning 双向绑定

## 8. Change Log

- 2026-08-30: R-E.1 walkthrough v01 — adapter interface + contract test + 本地 Space 留存; SDK 风险解除; agora-ts 不动
