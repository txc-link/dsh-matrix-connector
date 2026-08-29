# 实施排期 SSoT — dsh-matrix-connector (独立仓)

**Last updated**: 2026-08-29 (Asia/Shanghai)
**Owner**: 总工
**Repo**: txc-link/dsh-matrix-connector
**Phase**: 2 (matrix-connector @pull + three posture governance)

---

## 1. Status (Phase 2 启动中)

| Slice | Status | Depends on |
|---|---|---|
| 0. SSoT 建立 (本文件) | ✅ done | — |
| 1. task_dir 三件套 | ✅ done | §0 |
| 2. SSoT ↔ planning 双向绑定 | ✅ done | §1 |
| **3. matrix-connector @pull URI parser (Slice 1)** | ✅ **done (turn 20)** | §2 |
| **4. 三 posture governance (Slice 2)** | ✅ **done (turn 21)** | §3 |
| **5. ACL bundled 实施 (Slice 3)** | ✅ **done (turn 21)** | §3 + §4 |
| **6. @pull handler 集成 (Slice 4)** | ✅ **done (turn 21)** | §3+§4+§5 |
| 7. Discord 冒烟 / integration test (Slice 5) | ⏳ blocked (sandbox 限制, 需用户开发机) | §3+§4+§5+§6 |
| **8. walkthrough 回写 (Slice 5 walkthrough 部分)** | ✅ **done (turn 22)** | §7 |

---

## 2. Architecture Decisions (locked from Phase 1 ecosystem-design-inputs)

按 turn 59 lock + decisions.md SSoT (在 `dsh-agora/Doc/03-ARCHITECTURE/2026-08-30-ecosystem-design-inputs/decisions.md`):

| ID | Decision | Reference |
|---|---|---|
| **U1** | URI scheme = `agora://<type>/<id>` | decisions.md §U1 |
| **U2** | (Phase 4 真项目) — still undecided, 4 candidates | decisions.md §U2 |
| **U3** | Agent borrow posture = **C (Strict + Auto + Dangerous 三 posture + audit trail)** | decisions.md §U3 |
| **U4** | ACL = **A (bundled)** | decisions.md §U4 |

**Implementation implications for dsh-matrix-connector**:
- @pull 语法 = `agora://<type>/<id>` (U1)
- borrow governance = 三 posture enum + audit trail middleware (U3)
- ACL bundled = 一组权限在 cordis patch 里集中定义 (U4)

---

## 3. 8-keyword Framework + 受控 (turn 59 lock + Phase 1 capture)

dsh-matrix-connector @pull 必须覆盖 8 keyword + "受控" = 10 dim:

1. **create** (创建任务)
2. **read** (读取任务状态)
3. **update** (更新任务 metadata)
4. **delete** (取消任务)
5. **dispatch** (派发到 citizen)
6. **stuck** (stuck alert)
7. **rollup** (org war-room view)
8. **post-mortem** (per-task post-mortem)
9. **pull** (受控 — audit trail + posture)
10. **(未来 phase 3+)** computer use / QM / etc.

---

## 4. 三 Posture Governance (U3=C 实施)

### 4.1 Strict (default)
- 任何 @pull 操作必须经过 audit trail + posture check
- Auto posture 不可越权
- Dangerous posture 必须 dashboard 显式 confirm

### 4.2 Auto
- 简单查询操作 (read-only, no state change) 自动通过
- write ops 必须 strict
- 触发 audit trail 但不阻塞

### 4.3 Dangerous
- 必须 dashboard 显式 confirm
- audit trail 强制写
- 不可 Auto 通过

### 4.4 audit trail middleware
- 每次 @pull 写一条 record: actor + posture + URI + result
- 持久化到 SQLite / JSONL
- Dashboard 可查

---

## 5. ACL Bundled (U4=A 实施)

dsh-matrix-connector 内置一组 permission bundle:

```typescript
// docs/sample/acl-bundled.example.ts
export const matrixConnectorAcl = {
  // actor → permitted URI prefixes
  'human:dashboard': ['agora://*'],           // 全权限
  'agent:claude-code': ['agora://task/*', 'agora://event/*'],  // 任务 + 事件
  'agent:matrix-bridge': ['agora://event/*'],  // 只读事件
  'agent:postmortem-bot': ['agora://task/*/postmortem'],  // 限定 scope
};
```

每条 @pull URI → actor + ACL check → posture 选择 → 执行。

---

## 6. Phase 2 Slice Plan (按 AGENTS.md §4 TDD)

### Slice 1 — Test harness + matrix-connector @pull parser
- TDD 先行: 写 parser tests (10+ cases for URI parse/validate)
- 实现 URI parser (`agora://<type>/<id>` format)
- 87/87 已有 test 不能 break

### Slice 2 — Posture middleware
- TDD 先行: 写 posture resolution tests
- 实现 Strict / Auto / Dangerous 三 posture
- audit trail record schema

### Slice 3 — ACL bundled integration
- TDD 先行: 写 ACL check tests
- 实现 bundled ACL table + integration with parser
- 集成测试 (parser + posture + ACL)

### Slice 4 — @pull command handler
- TDD 先行: 写 handler tests
- 实现 @pull command dispatcher
- 与现有 bridges.ts 集成

### Slice 5 — Discord 冒烟 + integration test
- 与 Agora Core 集成测试
- Discord (如可用) 冒烟
- walkthrough 回写

---

## 7. Cross-references

- **Agora_Private 仓 SSoT**: `Agora_Private/docs/Agora-实施排期-Agora-TS.md` (实施权威入口, 本仓 reference only)
- **dsh-agora SSoT**: `dsh-agora/Doc/03-ARCHITECTURE/2026-08-30-ecosystem-design-inputs/decisions.md` (U1/U3/U4 决议 SSoT)
- **Phase 1 capture**: `dsh-agora/Doc/03-ARCHITECTURE/2026-08-30-ecosystem-design-inputs/` (4 captures + README + undecided + decisions + synopsis)
- **Phase 2 task_dir**: `Doc/09-PLANNING/TASKS/2026-08-30-phase-2-matrix-connector/` (在 worktree 内)
- **Phase 2 walkthrough**: `Doc/10-WALKTHROUGH/2026-08-30-phase-2-matrix-connector-walkthrough.md` (turn 22, ~250 行)
- **AGENTS.md §1 Core**: adapter layer 不能动 Core
- **AGENTS.md §3 SSoT**: SSoT 与 planning 必须双向绑定 (本文件 ↔ task_plan.md)

---

## 8. Change Log

- 2026-08-29: Phase 2 SSoT 建立 (本文件); turn 19 总工决策 Q-E1=a/Q-E2=d/Q-E3=a

---

## 9. Phase 3 — R-E Space 嵌套 (turn 142 启动)

### 9.1 Scope

R-E = connector 侧 Space 适配，让 matrix Space（聚合多房间的话题容器）作为 agora task 的可选 IM 容器。

- Space 子房间列表
- Space 事件流
- Space → room 路由（一个 Space 内的所有 child room 消息聚合到一个 thread）
- adapter 通过 matrix-js-sdk v34.13.0 Space API 实现

### 9.2 历史风险 (已记)

- matrix-js-sdk Space API 历史上 unstable → R-E 推到 phase 3
- Phase 3 启动时需重新验证 SDK v34.13.0 Space API 状态 (R-E.1 任务)

### 9.3 Status

| Slice | Status | Notes |
|---|---|---|
| **R-E.1 SDK Space API 验证 + adapter 设计 + TDD 失败测试** | ✅ **done (turn 143)** | contract 14 cases + 190/190 green; walkthrough `Doc/10-WALKTHROUGH/2026-08-30-r-e-space-nesting-v01.md` |
| **R-E.2 Space 实装 + 真实 Synapse Space 冒烟** | ✅ **done (turn 145)** | MatrixJsSdkSpaceTransport SDK 实装 + smoke 6/6 pass + cordis 注入; walkthrough `Doc/10-WALKTHROUGH/2026-08-30-r-e-space-nesting-v02.md` |

### 9.4 Worktree

| worktree | branch | 起点 | 当前 |
|---|---|---|---|
| `/home/ailink/dsh-agora/.worktrees/r-e-space-nesting` | `feat/r-e-space-nesting` | main `7603131` | empty |

### 9.5 与 R-D 的关系

- R-E 复用 R-D 链路的 recordInboundReply / auto-bind thread 入口
- Space 子房间的回复走同样路径回流 agora server
- agora-ts 侧本阶段不动 (governance 记 agora-ts SSoT §4)

### 9.6 跨仓 SSoT

- agora-ts SSoT: `dsh-agora/docs/Agora-实施排期-Agora-TS.md` (本阶段 agora-ts 不动)
- Dashboard SSoT: `dsh-agora/docs/Agora-实施排期-Dashboard.md` (R-F 并行, 不依赖 R-E)
- R-F task_plan: `dsh-agora/.worktrees/r-f-thread-web-detail/docs/09-PLANNING/TASKS/2026-08-30-r-f-thread-web-detail/`
