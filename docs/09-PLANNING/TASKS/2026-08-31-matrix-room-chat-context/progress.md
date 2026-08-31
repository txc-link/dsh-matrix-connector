# Progress — 最终

## Phase 0 — 工作区准备

- [x] `git fetch --prune origin main` → 4 commits ahead, fast-forwarded 7f8be59 → 559e303
- [x] 建 worktree `/home/ailink/dsh-matrix-connector.worktrees/fix-room-chat-context`，分支 `fix/matrix-room-chat-context`
- [x] 复制 `node_modules` 到 worktree
- [x] 建任务目录 `docs/09-PLANNING/TASKS/2026-08-31-matrix-room-chat-context/`
- [x] 写 `task_plan.md` / `findings.md` / 本文件

## Phase 1 — RED tests

- [x] 新文件 `tests/room-chat-context.test.mjs`（6 tests）：
  1. `DshDispatchClient` 把 `threadKey` 透传到 dispatch body
  2. `handleNaturalChat` 生成的 `idempotencyKey` 是 room-level
  3. 同 room 两条事件 → 相同 `idempotencyKey`
  4. 顶层 timeline：已绑 threadKey 的 room **不**进入 natural-chat
  5. 顶层 timeline：未绑 room 进入 natural-chat 并带 threadKey
  6. 同 room 两条事件 → threadKey / idempotencyKey 完全一致

初始跑（`node --test tests/room-chat-context.test.mjs`）：6/6 fail（RED ✅）。

## Phase 2 — GREEN impl

三处改动，全部最小：

| 文件 | 改动 |
|---|---|
| `src/natural-chat.ts` | `DshDispatchInput` 加 `threadKey?`；`DshDispatchClient.dispatch` body 透传 `threadKey`；`HandleNaturalChatOptions` 加 `buildThreadKey` 必填参数；`handleNaturalChat` 内部用 `buildThreadKey(roomId)` 计算 threadKey 和 room-level idempotencyKey |
| `src/index.ts` | `dispatchChatEvent` 装配时注入 `buildThreadKey`；`PluginOptions` 加 `threadRegistry?` test seam 默认 `new ThreadRegistry()`；顶层 timeline（608 行）加 `!registry.threadKeyFor(evt.roomId)` 守卫，对齐 678 行 space-child 行为 |
| `tests/natural-chat.test.mjs` + `tests/natural-chat-wiring.test.mjs` | 既有用例补 `buildThreadKey` 参数；idempotencyKey 断言改成 room-level 期望值 |

**未触碰**（per §1 / §1.5 硬约束）：
- dsh-agora server 的 `/api/craftsmen/dispatch` schema
- agora-ts 任何包
- ThreadRegistry 持久化

## Phase 3 — regression

- [x] 受影响测试套件（3 文件）：**18/18 pass**
- [x] 全套 unit + wiring 测试（37 文件）：**255/255 pass**，0 regress
- 跳过的 smoke 文件：`*smoke*.mjs`（需要真实 homeserver，跑不到；本任务是逻辑修复，无网络依赖）

## Phase 4 — 回写

- [x] 本 `progress.md`（更新到 worktree）
- [x] `docs/10-WALKTHROUGH/2026-08-31-matrix-room-chat-context.md`

## 总结

- 修改文件：4 个（2 src + 2 test）+ 新增 1 个测试文件
- 新增行：~50（test） + ~20（src）
- 删除行：~5（旧 idempotencyKey 公式）
- 总 diff：**小、专注、对称**
