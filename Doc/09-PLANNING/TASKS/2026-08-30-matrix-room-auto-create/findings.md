# Findings: R4 matrix Room 自动创建 (2026-08-30)

## 1. 调研事实

### turn 105-106 verify 状态

#### 已完成(R1-R3)
- **R1** (turn 104 step 2): decisions.md 锁 U1=A/U3=C/U4=A (用户 turn 106 "1" 授权)
 - 文件: `Doc/03-ARCHITECTURE/2026-08-30-ecosystem-design-inputs/decisions.md`
 - 已纠正 "拍板人 = 用户" → "总工 §1.5 first-principles + 用户 turn 106 授权"
- **R2** (turn 105 step 17-20): hygiene commit + push dsh-agora master
 - commit `61684ca` "docs(hygiene): capture Phase 1/2 ecosystem design + walkthrough mirror"
 - 50 files changed, 6109 insertions
 - push `80dda57..61684ca` 成功
 - untracked 仅剩 `.audit/` (按 §3 audit 是工作过程产物, 保留本地 OK)
- **R3** (turn 105 step 6-13): 3 PR 创建
 - PR1 新仓 `txc-link/dsh-matrix-connector#1` (feat/phase-2-matrix-connector)
 - PR2 dsh-agora `#3` (feat/phase-2-walkthrough-mirror)
 - PR3 dsh-agora `#4` (feat/phase-2-slice-6-cordis-integration)

#### 进行中(R4 partial)
- worktree `.worktrees/feat-matrix-room-auto-create/` (从 `feat/phase-2-matrix-connector` `705de4e` 拉)
- task_plan.md 完成 (58 lines)
- **未完成**: TDD, 实施, push, PR

## 2. R4 真范围与边界

### 必须做
1. `src/matrix-client.ts` 加 `createRoom` 方法 (~50 行)
2. `src/thread-registry.ts` 加持久化 layer (Room ID 映射, ~80 行)
3. `src/pull-handler.ts` 集成 Room 自动创建 (~30 行)
4. TDD: 8-12 test cases (matrix room create + thread registry + pull handler 集成)

### 不做 (§1.5 + turn 59)
- ❌ 不绑 Agora Core (§1 适配器只)
- ❌ 不引入 matrix-specific 业务规则到 Core (§1)
- ❌ 不做兼容层 (§1.5 0 overdesign)
- ❌ 不做降级路径 (§1.5)
- ❌ 不做 Discord smoke (sandbox 不可达)
- ❌ 不动 agora-ts/packages/core

### 已知限制
- thread-registry 持久化用 workspace fallback (sandbox ENOENT limitation)
- Discord smoke 不能在 sandbox 跑, 留 user-side
- Slice 6 cordis integration 已经在 dsh-agora 端 (PR3), R4 不再重复

## 3. turn 105-106 错操作历史

### turn 105 step 17 错开嵌套 worktree
- 路径 `.worktrees/feat-phase-2-pr-source/.worktrees/feat-matrix-room-auto-create/` (嵌套)
- 违反 §3 worktree first
- turn 106 step 1-2 纠正: clean + 真 clone 新仓到 `.worktrees/dsh-matrix-connector-root/` (独立 root)

### turn 105 step 18 错写 task_plan
- task_plan.md 写到嵌套路径
- turn 106 step 4 重新写到正确路径 `.worktrees/feat-matrix-room-auto-create/Doc/09-PLANNING/TASKS/2026-08-30-matrix-room-auto-create/task_plan.md`

### turn 106 step 2 clone 失败
- 路径 `/home/ailink/dsh-matrix-connector-work` → EROFS
- 原因: `/home/ailink/` 是 read-only filesystem
- 修正: 改 clone 到 dsh-agora `.worktrees/dsh-matrix-connector-root/` (sandbox writable)

## 4. R4 实施 plan (TDD 8-12 cases)

### Test cases (red)
1. matrix-client createRoom 返回 roomId + 持久化到 thread-registry
2. matrix-client createRoom idempotent (同一 threadId 不创建重复)
3. matrix-client createRoom 错误处理 (transport reject)
4. matrix-client createRoom 多次并发 (semaphore)
5. thread-registry load 时 ENOENT fallback (sandbox)
6. thread-registry save 时 ENOENT fallback
7. thread-registry map 双向 lookup (threadId ↔ roomId)
8. pull-handler agora://thread/<new> URI → 自动创建 Room
9. pull-handler agora://thread/<existing> URI → 走 registry lookup (不重建)
10. pull-handler agora://thread/<existing+stale> → 重建
11. pull-handler audit trail 记录 Room 创建 events
12. pull-handler posture middleware 集成 (Strict/Auto/Dangerous 决定 Room 可见性)

### 实施 steps (green)
1. matrix-client.ts 加 createRoom(theme, name, opts) → { roomId }
2. thread-registry.ts: JSONL path + workspace fallback
3. pull-handler.ts: parse → registry lookup → 创建 → audit

### Verify
- 8-12 cases 全绿
- 全 suite 147+N pass
- npm run build 0 errors
- 不破坏 baseline 87 + Slice 1-4 60 tests

## 5. 关联

### Phase 1 (merged develop `551fa532`)
- Doc/03-ARCHITECTURE/2026-08-29-shared-work-site/
- Doc/09-PLANNING/TASKS/2026-08-30-shared-work-site-phase-1/

### Phase 2 Slice 1-4 + Slice 6 (PR1 + PR3)
- 新仓 feat/phase-2-matrix-connector @ `705de4e`
- dsh-agora feat/phase-2-slice-6-cordis-integration @ `cfad5b6`

### Decisions (R1 锁)
- Doc/03-ARCHITECTURE/2026-08-30-ecosystem-design-inputs/decisions.md
- U1=A / U3=C / U4=A

### Hygiene (R2 完成)
- dsh-agora master `61684ca` 含 R2 commit

### PRs (R3 完成)
- 新仓 PR1: txc-link/dsh-matrix-connector#1
- dsh-agora PR2: txc-link/dsh-agora#3
- dsh-agora PR3: txc-link/dsh-agora#4