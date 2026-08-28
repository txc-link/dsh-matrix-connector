# Task Plan — Phase 2 (matrix-connector @pull + three posture governance)

**Task ID**: `2026-08-30-phase-2-matrix-connector`
**Date**: 2026-08-29 (Asia/Shanghai)
**Owner**: 总工 (DSH 主 agent, delegated subagent scope)
**Status**: ⏳ Slice 1 in progress (per [SSoT §1](../../../../Agora-实施排期-dsh-matrix-connector.md#1-status-phase-2-启动中))

---

## 0. Background

### 0.1 任务来源

按 turn 18 总工决议 Q-R3=a "split + push + 清理全完成后, 立即在新仓开 feat/phase-2-matrix-connector + task_dir"
+ turn 19 "总工决策, 不用问了, 全按推荐走" 全面授权
+ Phase 1 ecosystem-design-inputs capture 4 文件 + decisions.md SSoT (U1/U3/U4 决议):

- **U1 = A**: URI scheme = `agora://<type>/<id>`
- **U3 = C**: Agent borrow posture = 三 posture (Strict / Auto / Dangerous) + audit trail
- **U4 = A**: ACL = bundled

### 0.2 独立仓绑定方式 (Q-E2=d 总工决策)

按 turn 19 总工决策 **Q-E2=d — cordis dynamic plugin loader**:
- dsh-agora 通过 cordis loader 动态发现 dsh-matrix-connector
- 不需要 submodule / npm package / 手动 git clone
- 改动最小, 跟现在 cordis.patch.yml 模式一致
- 满足 AGENTS.md §2 Plugin 规则

### 0.3 SSoT (Q-E3=a 总工决策)

按 turn 19 总工决策 **Q-E3=a — 新建 Doc/Agora-实施排期-dsh-matrix-connector.md** (按 §3 SSoT 强制)

- SSoT 路径: `Doc/Agora-实施排期-dsh-matrix-connector.md` (本 worktree 内)
- task_dir 路径: `Doc/09-PLANNING/TASKS/2026-08-30-phase-2-matrix-connector/` (本 worktree 内)
- **双向绑定** (按 §3 SSoT 规则): SSoT §1 status table 含 task_dir 链接; 本 task_plan.md §1 含 SSoT 链接

---

## 1. SSoT 绑定 (per AGENTS.md §3)

本 task 双向绑定到 SSoT:
- 上行: [Doc/Agora-实施排期-dsh-matrix-connector.md §1 Status](../../../../Agora-实施排期-dsh-matrix-connector.md#1-status-phase-2-启动中) 包含本 task_dir 链接 + 当前 Slice 状态
- 下行: 本 task_plan.md §1 含 SSoT 链接 + 当前 Slice 状态 (见下)
- walkthrough: 待 Phase 2 完成时写到 `Doc/10-WALKTHROUGH/2026-08-30-phase-2-matrix-connector.md`

### SSoT Status 快照 (取自 SSoT §1)

| Slice | Status | Depends on |
|---|---|---|
| 0. SSoT 建立 | ✅ done | — |
| 1. task_dir 三件套 | ⏳ in progress | §0 |
| 2. SSoT ↔ planning 双向绑定 | ⏳ next | §1 |
| 3. matrix-connector @pull 实施 | ⏳ blocked | §2 |
| 4. 三 posture governance | ⏳ blocked | §3 |
| 5. ACL bundled | ⏳ blocked | §3 + §4 |
| 6. cordis dynamic plugin loader 验证 | ⏳ blocked | §3+§4+§5 |
| 7. Discord 冒烟 / integration test | ⏳ blocked | §3+§4+§5+§6 |
| 8. walkthrough 回写 | ⏳ blocked | §7 |

---

## 2. Slice 1 Plan (matrix-connector @pull parser — TDD 先行)

按 SSoT §6 Slice 1, TDD 先行:

### 2.1 测试先行 (先写 .test.mjs, 看到 fail)

| 测试 case | 输入 | 期望输出 |
|---|---|---|
| parse URI 1 | `agora://task/T-123` | `{ type: "task", id: "T-123" }` |
| parse URI 2 | `agora://event/E-abc-456` | `{ type: "event", id: "E-abc-456" }` |
| parse URI 3 | `agora://task/T-123/postmortem` | `{ type: "task", id: "T-123", sub: "postmortem" }` |
| parse URI 4 | `agora://*` (wildcard) | `{ type: "*", id: null }` |
| parse URI invalid 1 | `http://task/T-123` | throw Error("invalid scheme") |
| parse URI invalid 2 | `agora://` | throw Error("missing type") |
| parse URI invalid 3 | `agora://task/` | throw Error("missing id") |
| validate type 1 | `task` | true |
| validate type 2 | `event` | true |
| validate type 3 | `unknown` | false |
| validate id 1 | `T-123` | true (pattern: `<prefix>-<alphanumeric>`) |
| validate id 2 | `task-1` | false (no prefix-T pattern) |
| validate id 3 | `123` | false (no prefix) |
| validate id 4 | `T-` | false (no body) |
| build URI 1 | `{ type: "task", id: "T-123" }` | `agora://task/T-123` |
| build URI 2 | `{ type: "event", id: "E-abc", sub: "tick" }` | `agora://event/E-abc/tick` |

至少 16 个 test case, 覆盖 happy path + edge case + invalid input。

### 2.2 实现 (URI parser module)

新建 `src/uri-parser.ts`:

```typescript
// Pseudo-code (per AGENTS.md §1 adapter 不能硬编码 Agora Core 业务规则):
// 这里只 parse 字符串, 不查 Core 语义

export interface AgoraUri {
  scheme: 'agora';
  type: string;
  id: string;
  sub?: string;
}

export const VALID_TYPES = new Set(['task', 'event', 'participant', 'execution']);

export function parseAgoraUri(input: string): AgoraUri {
  // ... parse logic
}

export function validateType(type: string): boolean { ... }
export function validateId(id: string): boolean { ... }
export function buildAgoraUri(uri: Omit<AgoraUri, 'scheme'>): string { ... }
```

### 2.3 集成测试

新建 `tests/uri-parser.test.mjs` (16+ cases)。

### 2.4 跑测试

```bash
node --test tests/uri-parser.test.mjs
# 必须 16/16 pass
# 已有 87/87 测试不能 break
```

### 2.5 build verify

```bash
npm run build  # lib/ uri-parser.js + uri-parser.d.ts 生成
```

---

## 3. Slice 2 Plan (Posture middleware — TDD 先行)

按 SSoT §6 Slice 2:

### 3.1 测试先行

| 测试 case | 输入 | 期望输出 |
|---|---|---|
| resolve posture 1 | actor=`agent:claude-code`, uri=`agora://task/T-123`, op=`write` | posture=`Strict` |
| resolve posture 2 | actor=`agent:claude-code`, uri=`agora://event/E-1`, op=`read` | posture=`Auto` |
| resolve posture 3 | actor=`human:dashboard`, uri=`agora://task/T-123`, op=`delete` | posture=`Strict` (default) |
| resolve posture 4 | actor=`agent:matrix-bridge`, uri=`agora://event/E-1`, op=`read` | posture=`Auto` |
| resolve posture 5 | actor=`agent:matrix-bridge`, uri=`agora://task/T-123`, op=`write` | throw Error("actor not permitted") |
| audit trail 1 | any call | audit record written to log |
| audit trail 2 | dangerous posture | audit record with `requires_confirm: true` |
| audit trail 3 | fail case | audit record with `result: "fail"`, `error: "..."` |

### 3.2 实现

新建 `src/posture-middleware.ts` + `src/audit-trail.ts`。

### 3.3 集成

与 uri-parser 集成: 每次 @pull 先 parse URI → resolve posture → execute → audit trail。

---

## 4. Slice 3 Plan (ACL bundled — TDD 先行)

按 SSoT §6 Slice 3:

### 4.1 测试先行

ACL bundled table (per SSoT §5) → tests 覆盖每条 ACL entry:

- 12+ ACL test cases (actor × URI → allowed/denied)

### 4.2 实现

新建 `src/acl-bundled.ts` (const ACL_TABLE) + `src/acl-checker.ts`。

### 4.3 集成

acl-checker + uri-parser + posture-middleware 三者串起来。

---

## 5. Slice 4 Plan (@pull command handler)

按 SSoT §6 Slice 4:

- TDD 写 handler tests
- 实现 `src/pull-command.ts`
- 与现有 `bridges.ts` 集成 (dispatch to Matrix room)
- Matrix 房间事件 → @pull URI → execute

---

## 6. Slice 5 Plan (Discord 冒烟 + integration test)

按 SSoT §6 Slice 5 + AGENTS.md §4 强制:

- 集成测试 (parser + posture + ACL + handler)
- Discord 冒烟 (如可用, 本 sandbox 不可用 → 在用户开发机验证)
- walkthrough 回写到 `Doc/10-WALKTHROUGH/2026-08-30-phase-2-matrix-connector.md`

---

## 7. AGENTS.md Compliance Matrix

| AGENTS.md 规则 | Slice 1 实施 | 备注 |
|---|---|---|
| §1 Core 硬约束 | ✅ parser 不动 Core | URI parse 是 adapter 内部 |
| §1.5 first-principles | ✅ 0 兼容, 0 兜底, 0 overdesign | strict parse + throw on invalid |
| §2 Plugin 规则 | ✅ adapter 边界清晰 | parser 只对 Matrix 入口暴露 |
| §3 mandatory planning | ✅ task_dir 三件套 | 本文件 + findings + progress |
| §3 SSoT | ✅ 双向绑定 | 见 §1 |
| §4 TDD | ✅ 测试先行 | Slice 1.1 先写 16 cases |
| §4 completion loop | ✅ 回写 SSoT + planning + walkthrough | Slice 5 完成时回写 |
| §6 Repo Map | ✅ adapter 在 dsh-matrix-connector | 独立仓 |
| §8 Docs/Git | ✅ 内部 Doc/ 不推 FairladyZ625/Agora | 新仓 Doc/ 全内部 |

---

## 8. Risk Register

| Risk | Mitigation |
|---|---|
| URI parser 跟 Agora Core URI 语义冲突 | parser 只对 Matrix adapter 暴露, Core 有自己 URI 处理, 不共享 |
| posture middleware 性能影响 audit trail | audit trail 异步写 (不阻塞 request) |
| ACL bundled 跟 dsh-agora 现有 ACL 不兼容 | dsh-agora ACL 是 Core 内部, dsh-matrix-connector ACL 是 adapter 层, 不冲突 |
| cordis dynamic plugin loader 失败 | Slice 6 验证, 失败 fallback 到 manual install |
| Discord 不可用 (sandbox 限制) | 跑集成测试替代, 在用户开发机补冒烟 |
| 87/87 已有测试 break | 严格 TDD, 每加一行跑一次 node --test |

---

## 9. Next Action (turn 19 step 4)

1. ⏳ 立即跑 Phase E.4 task_dir 三件套 (findings.md + progress.md)
2. ⏳ Phase E.5 SSoT ↔ planning 双向绑定 verify (cross-link check)
3. ⏳ Phase E.6 SSoT §1 status table 更新 (slice 1 → done, slice 2 → in progress)
4. ⏸ **Slice 1 实施 (matrix-connector @pull parser)**: turn 20+ 启动, TDD 16 cases 先行

(Phase 2 实施 = 多 slice + 多文件 + 多测试, 不可能 turn 19 一 turn 做完。按 AGENTS.md §4 TDD 强制, 每个 slice 必须先测后实现 + 集成 verify。Phase 2 实质内容 turn 20+ 启动, 本 turn 仅完成 setup。)