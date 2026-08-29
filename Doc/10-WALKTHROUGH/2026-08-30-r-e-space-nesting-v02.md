# Walkthrough — R-E Space 嵌套 v0.2 (R-E.2 完成)

**Date**: 2026-08-30 (Asia/Shanghai)
**Phase**: 3 (matrix-connector Space nesting)
**Branch**: `feat/r-e-space-nesting` (worktree `/home/ailink/dsh-agora/.worktrees/r-e-space-nesting`)
**Author**: 总工 + R-E.1/R-E.2 实施 subagents
**Status**: R-E ✅ done (R-E.1 + R-E.2 全部完成, 190/190 green + 真实 smoke 全过)

---

## 1. TL;DR

R-E 完成 = connector 侧 Space adapter 全栈实装：
- **adapter interface** (`MatrixSpaceAdapter` 4 方法 + `MatrixSpaceTransport` seam + `SpaceConfig`)
- **matrix-js-sdk-backed transport** (`MatrixJsSdkSpaceTransport` 4 方法实装)
- **cordis 注入** (opt-in 默认关闭, `config.spaces?.enabled === true` 才挂载)
- **真实 Synapse Space 冒烟全过** (6 项断言)

§1 boundary 严守：**不动 agora Core / agora REST / agora server**。`SpaceEvent.message` 并入现有 `ingestMatrixReply` 通道（与 R-D 链路共享）。

## 2. Files changed (R-E.1 + R-E.2 全量)

### R-E.1 (turn 143)
| File | Type | Purpose |
|---|---|---|
| `src/space-adapter.ts` | new (173 lines) | `SpaceRef` / `SpaceChild` / `SpaceEvent` 类型 + `MatrixSpaceAdapter` + `MatrixSpaceTransport` seam |
| `tests/space-adapter.test.mjs` | new (14 cases) | frozen contract; stub transport 全绿 |
| `src/config.ts` | modified (+12) | `MatrixConnectorConfig.spaces?: SpaceConfig` + `buildConfig` Omit 排除 |
| `Doc/09-PLANNING/TASKS/.../task_plan.md` | new | 总工排期 |
| `Doc/09-PLANNING/TASKS/.../findings.md` | new | SDK 评估 / Synapse 验证 / adapter 动机 / TDD 统计 |
| `Doc/09-PLANNING/TASKS/.../progress.md` | new | R-E.1 步骤 + Verification |
| `Doc/10-WALKTHROUGH/2026-08-30-r-e-space-nesting-v01.md` | new | R-E.1 walkthrough |

### R-E.2 (turn 145)
| File | Type | Purpose |
|---|---|---|
| `src/transport/space-transport.ts` | new | `MatrixJsSdkSpaceTransport` 4 方法 SDK 实现 |
| `tests/smoke-v060-space-nesting.mjs` | new | 真实 homeserver smoke (6 断言) |
| `src/transport/matrix-js-sdk.ts` | modified (+12) | `getSdk()` accessor 共享 SDK client |
| `src/transport/index.ts` | modified (+7/-1) | 重导出 space transport |
| `src/index.ts` | modified (+68) | `PluginOptions.matrixJsSdkTransport?` + composition mount (gated by `config.spaces?.enabled === true`) |
| `cordis.patch.yml` | modified | 加注释段 + 注释掉的 `spaces: { enabled: true, rootSpaces: [...] }` 样板块（默认 OFF）|
| `Doc/09-PLANNING/TASKS/.../findings.md` | modified | 加 R-E.2 段 (SDK API 映射表 + smoke 结果) |
| `Doc/09-PLANNING/TASKS/.../progress.md` | modified | R-E.2 checkbox 全勾 |
| `Doc/09-PLANNING/TASKS/.../task_plan.md` | modified | §2.5 R-E.2 实测结果表 |

`package.json` / `package-lock.json` **未改** (SDK ^34.13.0 已覆盖所有 R-E.2 surface)。

## 3. Architecture decisions locked (R-E 全量)

| ID | Decision | Why |
|---|---|---|
| **E1** | R-E = connector 侧 Space adapter, 不动 agora Core / REST / server | §1 三层口径 — Space 是 IM 拓扑, 属于 adapter 范畴 |
| **E2** | `SpaceConfig` opt-in 默认 `enabled: false` | 不破坏现有 v0.5 deployment; `buildConfig` `Required<Omit<...,'spaces'>>` 已排除 |
| **E3** | `MatrixSpaceTransport` seam + stub 测试 → SDK 实装 | host 测试无需 homeserver; R-E.2 在同一 contract 上加 SDK 实现 |
| **E4** | **不新增 agora REST 端点** | `SpaceEvent.message` 字段已含 `spaceId + childRoomId + eventId + sender + body`, 足够 Core 消费; 并入 `message-router.ts` / `ingestMatrixReply` 现有 inbound 通道 |
| **E5** | `SpaceEvent` discriminated union 合并 state 变更 + child timeline | Core 只需订阅一个流, 避免维护两套订阅 |
| **E6** | `MatrixJsSdkSpaceTransport` 通过 `getSdk()` 共享 `SdkMatrixClient` + /sync + Room cache | 避免双 /sync loop + 重复 Room 缓存 |
| **E7** | `Room.timeline` 独立挂 room 级 listener (与 R-D client 级并存) | 不同订阅粒度: R-D 监听所有 room inbound; R-E 只监听 Space + children |

## 4. Verification (R-E.1 + R-E.2 全量)

### R-E.1
- `npm test` → **190 pass / 0 fail** (baseline 176 + 新增 14 contract cases)
- frozen contract 在 stub transport 下全绿 → 真实 red signal 来自 R-E.2 transport 缺失/错误时

### R-E.2
- `npm test` → **190 pass / 0 fail** (R-E.1 contract **零转红**)
- `node tests/smoke-v060-space-nesting.mjs` → **ALL ASSERTIONS PASSED, exit 0**:
  - `isSpaceRoom(SPACE)=true`
  - `isSpaceRoom(CHILD_A)=false`
  - `listChildRooms(SPACE).length=2`
  - `getSpaceHierarchy(SPACE).children.length=2`
  - live `kind=message` (bot 发 ChildA 消息 → handler 收到)
  - live `kind=child-added` (bot 写 `m.space.child` state → handler 收到)
- `npm run build` → no TS errors

### 本机 Synapse Space 实测留存 (R-E.1 + R-E.2 共用)

| 角色 | ID |
|---|---|
| Space root | `!OCNKEikkiiJEMdWyiQ:agent-hub.local` |
| Child A | `!MZMrZgRuHQTCumysHu:agent-hub.local` (order=a, suggested=true) |
| Child B | `!ReGdGmbaNfUYgtlfnN:agent-hub.local` (order=b, suggested=false) |
| Smoke bot | `@r-e-smoke:agent-hub.local` |
| Smoke 临时 ChildC | state 已清理, room 留存 (smoke 副作用, 不影响 R-E.2 完成度) |

## 5. 启用方式 (生产部署者)

`cordis.patch.yml` 加:

```yaml
- insert:
    - id: matrix-connector
      config:
        # ... existing config ...
        spaces:
          enabled: true
          rootSpaces:
            - '!OCNKEikkiiJEMdWyiQ:agent-hub.local'  # 替换为生产 Space ID
```

**未启用时零影响** (v0.5 caller `config.spaces === undefined` → 不挂载 `MatrixSpaceAdapter`)。

## 6. 已知副作用 / 未决

- **Smoke 临时 ChildC room** 未删 (state 已清理, room 留存于 Synapse). 不影响 R-E.2 完成度; 如需清理可手动 `POST /_matrix/client/v3/rooms/{childC}/leave` + admin purge
- **无 governance 决策需要上报**
- **SDK 无 gap**: matrix-js-sdk@34.13.0 已覆盖 R-E.2 全部 surface

## 7. Cross-references

- **SSoT phase 3**: `Doc/Agora-实施排期-dsh-matrix-connector.md` §9 (R-E 全部 done)
- **task_dir**: `Doc/09-PLANNING/TASKS/2026-08-30-r-e-space-nesting/`
- **findings**: `Doc/09-PLANNING/TASKS/2026-08-30-r-e-space-nesting/findings.md`
- **v01 walkthrough**: `Doc/10-WALKTHROUGH/2026-08-30-r-e-space-nesting-v01.md` (R-E.1 单独记录)
- **agora-ts SSoT**: `Doc/Agora-实施排期-Agora-TS.md` §4 (本阶段 agora-ts 不动, **完全不动** ✓)
- **AGENTS.md §1**: adapter 不动 Core
- **AGENTS.md §3**: SSoT ↔ planning 双向绑定

## 8. Change Log

- 2026-08-30: R-E.2 walkthrough v02 — MatrixJsSdkSpaceTransport + 真实 smoke + cordis 注入; R-E phase 3 完整闭环
- 2026-08-30: R-E.1 walkthrough v01 — adapter interface + contract test (archived, 历史记录)
