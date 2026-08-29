# R-E Space 嵌套 — task_plan

**Task**: R-E Space 嵌套（matrix-js-sdk Space API + connector 侧 Space 适配）
**Date**: 2026-08-30
**Owner**: 总工
**Repo**: txc-link/dsh-matrix-connector (matrix 仓)
**Worktree**: `/home/ailink/dsh-agora/.worktrees/r-e-space-nesting`
**Branch**: `feat/r-e-space-nesting` (from main `7603131`)
**SSoT**: `Doc/Agora-实施排期-dsh-matrix-connector.md` (phase 3)
**agora-ts SSoT 联动**: `dsh-agora/docs/Agora-实施排期-Agora-TS.md` §4 (本阶段 agora-ts 不动)

---

## 1. 总工排期 (4 轮 + 2 治理债)

| 轮 | 范围 | worktree | 状态 |
|---|---|---|---|
| R-E.1 | SDK Space API 能力验证 + adapter 设计 + TDD 失败测试 | 本 worktree | ⏳ in_progress |
| R-E.2 | Space 实装 + 真实 Synapse Space 冒烟 | 本 worktree | ⏳ blocked on R-E.1 |
| R-F.1 | dashboard thread 数据接入 | 主仓 `.worktrees/r-f-thread-web-detail` | ⏳ in_progress (并行) |
| R-F.2 | real-time updates + E2E | 同 R-F.1 | ⏳ blocked on R-F.1 |
| 治理债1 | agora-ts SSoT 新建 + 60b01a6 回写 | 主仓 master (直接 commit) | ✅ done (turn 142) |
| 治理债2 | matrix SSoT 加 phase 3 + dashboard SSoT 新建 | matrix main + 主仓 master | ⏳ done in turn 142 |

---

## 2. R-E.1 详细计划

### 2.1 目标
- 验证 matrix-js-sdk v34.13.0 是否已稳定 Space API (历史上 unstable, 是 R-E 推到 v0.5 的原因)
- 设计 connector 侧 Space adapter 接口 (`MatrixSpaceAdapter`)
- 写 TDD 失败测试: Space 子房间列表 / Space 事件流 / Space → room 路由

### 2.2 子步骤
1. 读 matrix-js-sdk v34.13.0 的 Space 相关 API (类型 + 方法)
2. 验证本地 Synapse 是否启用 Space 功能 (`experimental_features.spaces_enabled`)
3. 在本地 Synapse 创建一个测试 Space (root + 2 child rooms)
4. 写 adapter 接口 (TypeScript) + 测试用例 (red)
5. 设计 Space 事件如何投影到 agora server REST

### 2.3 风险
- SDK Space API 仍不稳定 → 可能要 pin 特定版本或退回到 MSC1772 协议层封装
- Synapse 默认 Space disabled → 需要 admin 启用 + 配置

### 2.4 验证标准（实测结果 2026-08-30）

| 标准 | 结果 |
|---|---|
| adapter 接口编译通过 | ✅ `npm run build` 无 TS error |
| TDD 红测 8+ cases | ✅ `tests/space-adapter.test.mjs` 14 cases |
| `npm test` 跑出预期状态 | ✅ 190 / 190 绿（baseline 176 + 14 新增）— 真实 red 在 R-E.2 matrix-js-sdk-backed transport 缺失时显现 |
| Synapse 测试 Space 创建成功 | ✅ Space `!OCNKEikkiiJEMdWyiQ:agent-hub.local` + child A `!MZMrZgRuHQTCumysHu:agent-hub.local` + child B `!ReGdGmbaNfUYgtlfnN:agent-hub.local` |
| `/hierarchy` endpoint 验证 | ✅ 返回 3 rooms，root.room_type === "m.space"，children_state 含 `order`/`suggested`/`via` |
| Synapse `spaces_enabled` 验证 | ✅ Synapse 1.155.0 默认开启；homeserver.yaml 无 spaces_enabled flag（v1.86+ 已 stable 化） |
| adapter 接口签名稳定 | ✅ 无破坏现有 config；`spaces?` optional + `buildConfig` Omit 排除 |
| SDK Space API stable / 部分 stable 评估 | ✅ `getRoomHierarchy` (MSC2946) + `Room.isSpaceRoom()` + `RoomType.Space` + `EventType.SpaceChild` 全 stable；`unstableCreateFileTree` (MSC3089) 未涉及 |

---

## 3. 文件 / 交付物

### R-E.1 预期文件
- `src/space-adapter.ts` (新)
- `tests/space-adapter.test.mjs` (新)
- `src/config.ts` 增加 `spaces?: SpaceConfig` (不破坏现有 config)
- `Doc/09-PLANNING/TASKS/2026-08-30-r-e-space-nesting/findings.md` (SDK 能力评估)
- `Doc/09-PLANNING/TASKS/2026-08-30-r-e-space-nesting/progress.md` (R-E.1 状态)

---

## 4. 与其他排期 / 任务的依赖

- **R-D 链路**: R-D 完成 (60b01a6 + 9fce111 + walkthrough shared-work-site-phase-1) — Space 必须通过 R-D 的 recordInboundReply 路径回流到 agora server
- **agora-ts SSoT**: 本阶段 agora-ts 不动; 但 R-E.1 若发现 agora REST 缺 Space 聚合端点, 触发 §6 流程
- **R-F**: 独立并行, 不依赖 R-E

---

## 5. Change Log

- 2026-08-30: R-E task_plan 建立; 总工排期 (R-E 2 轮 + R-F 2 轮 + 治理债 2 项)
