# Task: R4 matrix Room 自动创建 (Phase 2 实质第二段)

## 1. 目标

完成 Phase 2 实施中的 matrix Room 自动创建逻辑, 让 `pull-handler` 能在 `agora://thread/<id>` URI 不存在对应 matrix Room 时自动创建 (符合 turn 59 决议 "matrix 模拟 Discord thread 用多 Room")。

## 2. §1 + §1.5 + §2 约束

- §1: matrix-connector 是 adapter, 不绑 Agora Core, Room 创建逻辑是 adapter 内部
- §1.5: 0 overdesign, 0 compat, 0 fallback (除 audit-trail sandbox ENOENT 是 limitation)
- §3: 本任务开 worktree `feat/matrix-room-auto-create` (从 feat/phase-2-matrix-connector 拉), task_dir 三件套
- §4: TDD (red→green), 8-12 test cases 先写, 再实施, 再 verify
- §8: Doc/ 在新仓内部, 不推 dsh-agora master (mirror rule)

## 3. 阶段

1. ✅ turn 106 step 3-4: 开 worktree + 建 task_dir
2. ⏳ TDD step 1: `tests/matrix-room-auto-create.test.mjs` 8-12 cases 先写
3. ⏳ TDD step 2: 跑 test → 红
4. ⏳ TDD step 3: `src/matrix-client.ts` 加 `createRoom` 方法
5. ⏳ TDD step 4: `src/thread-registry.ts` 加持久化 (Room ID 映射)
6. ⏳ TDD step 5: `src/pull-handler.ts` 加 Room 自动创建集成
7. ⏳ TDD step 6: 跑 test → 绿
8. ⏳ verify: full suite 147+N pass, npm run build 0 errors
9. ⏳ commit + push + PR 起草
10. ⏳ emit L1 receipt

## 4. Constitution Constraints

- 不动 Agora Core
- 不动 agora-ts/packages/core
- 不动 dsh-agora master (R4 是新仓内 Phase 2 第二段)
- workspace backup 前 commit

## 5. worktree / 分支

- worktree: `/home/ailink/dsh-agora/.worktrees/feat-matrix-room-auto-create/`
- 新仓 root: `/home/ailink/dsh-agora/.worktrees/dsh-matrix-connector-root/`
- branch: `feat/matrix-room-auto-create`
- base: `feat/phase-2-matrix-connector` @ `705de4e`

## 6. 验证口径

- 8-12 test cases 全部 pass (matrix room create + thread registry + pull handler 集成)
- 全 suite 147+N pass (N = new cases)
- npm run build 0 errors
- 不破坏 87 baseline + 60 Slice 1-4 tests
- thread-registry 持久化 path (workspace fallback for sandbox)
- audit trail 记录 Room 创建 events

## 7. Turn 106 cleanup history

- turn 105 step 17 错开嵌套 worktree (`.worktrees/feat-phase-2-pr-source/.worktrees/...`) — turn 106 step 1-3 纠正
- turn 105 step 18 错写 task_plan.md 到嵌套路径 — turn 106 step 4 重新写到正确路径
- turn 106 step 2 clone `/home/ailink/dsh-matrix-connector-work/` 失败 (EROFS) — turn 106 step 3 改到 dsh-agora/.worktrees/dsh-matrix-connector-root/