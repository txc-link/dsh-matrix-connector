# Findings — Phase 2 (matrix-connector @pull + three posture governance)

**Task**: `2026-08-30-phase-2-matrix-connector`
**Date**: 2026-08-29 (Asia/Shanghai)
**Owner**: 总工

---

## 1. Phase 2 启动事实 (turn 19)

### 1.1 新仓状态 (Q-R3=a 完成 → Phase 2 启动)

- **新仓**: `txc-link/dsh-matrix-connector` (https://github.com/txc-link/dsh-matrix-connector)
- **新仓 HEAD**: `c1ab6fd56373fcb702b85440dea29c02b462289c` (13 commits + 46 文件 + 87/87 tests pass)
- **Clone 路径 (worktree-1)**: `/home/ailink/dsh-agora/.worktrees/feat-phase-2-matrix-connector` ([main])
- **Worktree 路径 (worktree-2)**: `/home/ailink/dsh-agora/.worktrees/feat-phase-2-worktree` ([feat/phase-2-matrix-connector])

### 1.2 双 worktree 结构 (using-git-worktrees Step 3 标准做法)

```
feat-phase-2-matrix-connector/   ← 持 main 分支 (fresh clone)
feat-phase-2-worktree/           ← 持 feat/phase-2-matrix-connector 分支 (新加)
```

原因: 新仓 fresh clone 时没有现成 worktree, `git worktree add -b` 必须在**已有仓**内跑 — 所以先 clone main worktree, 再 add feat worktree。

### 1.3 SSoT (Q-E3=a 完成)

- **SSoT 文件**: `Doc/Agora-实施排期-dsh-matrix-connector.md` (5007 bytes, 8 节)
- **task_dir**: `Doc/09-PLANNING/TASKS/2026-08-30-phase-2-matrix-connector/` (task_plan.md / findings.md / progress.md 三件套)
- **Doc/11-REFERENCE/agora-core-decoupling-standard.md** (2002 bytes, AGENTS.md §1 reference stub)

### 1.4 绑定方式 (Q-E2=d 完成)

- dsh-matrix-connector 通过 **cordis dynamic plugin loader** 跟 dsh-agora 绑定
- 改动最小, 跟现有 cordis.patch.yml 模式一致
- 不需要 submodule / npm package / manual git clone

---

## 2. Phase 1 决议引用 (turn 79 之前 locked)

按 dsh-agora superproject 内 `Doc/03-ARCHITECTURE/2026-08-30-ecosystem-design-inputs/decisions.md`:

| ID | Decision | Phase 2 实施 implication |
|---|---|---|
| **U1** | URI scheme = `agora://<type>/<id>` | @pull parser 必须支持此 scheme |
| **U2** | (Phase 4 真项目) — 4 candidates, undecided | 不影响 Phase 2 |
| **U3** | Agent borrow = 三 posture + audit trail | posture-middleware 必须有 Strict/Auto/Dangerous + audit trail |
| **U4** | ACL bundled | bundled ACL table 在 adapter 层, 不在 Core |

---

## 3. AGENTS.md §6 Repo Map 调整事实

| 旧状态 | 新状态 |
|---|---|
| `extensions/agora-plugin/` 在 dsh-agora 内 | dsh-matrix-connector 已**独立**到 GitHub `txc-link/dsh-matrix-connector` |
| dsh-agora extensions 通过 cordis patch bundle dsh-matrix-connector 子目录 | dsh-agora 通过 cordis dynamic plugin loader 动态发现 |
| 同仓, 同 package.json, 同 node_modules | 跨仓, peerDep `dsh-agora: ^0.6.0 (optional)` |

→ 新仓 `package.json` 第 32 行明确 `peerDependencies.dsh-agora: "^0.6.0"` + `peerDependenciesMeta.dsh-agora: { optional: true }`

---

## 4. 87/87 test 状态 (snapshot)

新仓 main 分支 HEAD `c1ab6fd` 跑测试结果:
```
ℹ tests 87
ℹ suites 8
ℹ pass 87
ℹ fail 0
ℹ duration_ms 219.126637
```

8 suites 覆盖:
1. buildStatusPanel
2. buildStuckAlert
3. renderStuckList
4. buildThreadKey
5. ThreadRegistry (upsertPlaceholder / resolveTaskId / has/get / size/clear)
6. + 其他 3 suites (artifact-summary / bridges / dispatch-bridge / rollup / etc.)

→ **Phase 2 Slice 1 必须保证 87/87 仍然 pass** + 新增 16+ URI parser tests = **103/103+ pass**。

---

## 5. Open Questions (Phase 2 实施中遇到再问)

### 5.1 URI type 白名单

```typescript
export const VALID_TYPES = new Set(['task', 'event', 'participant', 'execution']);
```

这 4 个 type 是从 Phase 1 决议推断的 (U1=agora://<type>/<id>), 但 **Core 实际 URI type 白名单** 在 `Agora_Private/agora-ts/packages/core/src/uri-validator.ts` 里 (本仓**不可达**).

→ Slice 1 实施时**先按 4 个 type 写**, 集成时如果 Core URI 范围不同, expand set. (低风险, 不用现在问。)

### 5.2 Posture 表 hard-code 还是 plugin-loadable?

`posture-middleware.ts` 内的 posture resolution 表 (actor × URI × op → posture) 可以:
- (a) hard-code 在 dsh-matrix-connector 内 (simple, fast)
- (b) 从 dsh-agora Core 动态加载 (consistent, slow)
- (c) bundled in dsh-matrix-connector's cordis patch (middle ground)

→ Slice 2 实施时**默认 (a)**, 如果 Phase 3+ 出现动态需求再改 (b)。

### 5.3 ACL bundled 跟 dsh-agora 现有 ACL 关系

dsh-agora Core 已有 ACL, dsh-matrix-connector ACL 是 adapter 层 bundled。两层 ACL:
- (a) 先 adapter ACL check → 再 Core ACL check (double-check, 更安全)
- (b) 只 adapter ACL check, Core 信任 adapter (single-check, 更快)
- (c) 只 Core ACL check, adapter 不管 (反模式)

→ Slice 3 实施时**默认 (a)**, double-check 是 best practice。

### 5.4 Discord 冒烟 sandbox 不可用

按 turn 17 之前 verify: 本 sandbox 不能跑 Discord (没 Discord token + 网络限制)。
→ Slice 5 (Discord 冒烟) **必须在用户开发机跑**, 本 sandbox 只能跑集成测试。

---

## 6. 跟 Graph Memory 数据交叉

| GM node | 状态 | 影响 |
|---|---|---|
| c-4 dsh-matrix-connector-v011-committed | ⚠️ 过时 (v0.1.1, 实际 v2.0.2) | 已被 turn 17 verify 推翻 |
| c-415 dsh-matrix-connector-v01-completion-state | ⚠️ 过时 (v0.1 47/47, 实际 87/87) | 已被 turn 17 verify 推翻 |
| c-447 v03-war-room-worktree-opened | ❌ 错误 (worktree 不存在) | 已被 turn 17 verify 推翻 |
| c-38 turn 75 historical skills (provision-bot / synapse-admin / recalibrate) | ⚠️ 部分过时 | Phase 2 实施前重 verify |
| **c-82 git-worktree-remove-cleanup skill** | ✅ 有效 | turn 18 Phase D cleanup 已用 |

→ **GM 数据治理经验**: 任何 GM 引用必须先 verify, 不能盲信。

---

## 7. Sources

- turn 16 user: "feat/dsh-matrix-connector 代码在哪 不是独立仓库吗, 请在github新建仓库"
- turn 17 user: "你来新建空仓, 我登录了gh你可操作"
- turn 18 user: "开会 总工决策就行, 我不管细节" (Q-R1/R2/R3/TD 总工授权)
- turn 19 user: "总工决策, 不用问了, 全按推荐走" (Q-E1/E2/E3 完全授权)
- AGENTS.md §1-§8 (本 session system-reminder)
- 4 skill catalog (本 session system-reminder)
- Phase 1 capture: `dsh-agora/Doc/03-ARCHITECTURE/2026-08-30-ecosystem-design-inputs/` (4 captures + README + undecided + decisions + synopsis)
- Phase 1 task_dir: `dsh-agora/Doc/09-PLANNING/TASKS/2026-08-30-ecosystem-design-inputs/` (task_plan + findings + progress)
- 本 turn verify 输出 (Phase A→D split task closure)

---

## 8. Anti-Entropy Declaration (Phase 2 = additive only)

**Deletion Class**: **none** — Phase 2 严格 **additive** (新加 URI parser + posture middleware + ACL bundled + handler), 不删任何已有 code.

**Risk**: 87/87 已有 test 不能 break。

**Mitigation**: 严格 TDD (每加一行跑一次 node --test), 集成测试 verify 总数 ≥ 87+。

**User Confirmation Required**: ✅ 已获 turn 19 完全授权 "全按推荐走"