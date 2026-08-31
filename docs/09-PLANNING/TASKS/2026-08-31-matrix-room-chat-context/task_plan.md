# 2026-08-31 — Matrix room chat context continuity

## 1. Intent

Element Matrix room (group chat) 上 natural-chat 路径每条消息都被当作一个全新的 DSH web 会话，导致同一房间的连续对话上下文完全丢失。这破坏了"在 IM 里跟 agent 连续聊"的核心产品语义。

## 2. Confirmed vs Undecided

### 已确认（locked by user 2026-08-31 turn 4）

- 故障范围：DSH web **本地会话页**（natural-chat 路径调本地 `/dsh-agora/api/dispatch` facade）
- 不是 dsh-agora server 的 `/api/craftsmen/dispatch`，也不是 agora-ts 任何包
- 改动最小集：
  1. `src/index.ts:608-617` 顶层 timeline 加 `!registry.threadKeyFor(roomId)` 守卫，对齐 678 行 space-child 行为
  2. `src/natural-chat.ts` 把 idempotencyKey 改成 room 级（不是 per-eventId），并在 dispatch body 里带 `threadKey`（让 DSH web facade 知道是同一个房间的延续）
  3. RED → GREEN → regression 测试
  4. 回写 SSoT / planning / walkthrough

### 显式排除（OUT of scope）

- ❌ 改 dsh-agora server 的 `/api/craftsmen/dispatch` schema（AGENTS.md §1 Core 硬边界）
- ❌ 改 agora-ts 包（Core 硬边界）
- ❌ ThreadRegistry 持久化（独立 ticket，未在本任务内）
- ❌ 兼容 / 补丁 / 兜底代码（AGENTS.md §1.5）
- ❌ 自然对话历史注入 prompt（仅修复 session 复用，不重写 prompt 策略）

## 3. Three Root Causes

| # | 位置 | 问题 |
|---|---|---|
| R1 | `src/natural-chat.ts:145` | `idempotencyKey = matrix-${eventId ?? ...}`，每条消息 eventId 不同 → DSH web 看到的是新 dispatch 实体 |
| R2 | `src/natural-chat.ts:71-82` | `DshDispatchClient.dispatch` 的 body 不带 threadKey/roomId → DSH web facade 无法识别"同一个房间" |
| R3 | `src/index.ts:608-617` | 顶层 timeline 缺 `!registry.threadKeyFor(roomId)` 守卫，对比 678 行 space-child 已有该守卫 |

## 4. Design invariant (after fix)

- **已绑 threadKey 的 room**（用户此前用过 `/agora ...` 命令创建过 task）：非命令消息 → reply-ingest 路径 → 沿用既有 task 会话
- **未绑 threadKey 的 room**：非命令消息 → natural-chat → DSH web 本地 facade
- 同一事件**不能**两条路径同时触发（避免上下文碎片化）

## 5. Phases

| Phase | 内容 | Status |
|---|---|---|
| 0 | 建 worktree、复制 node_modules、建任务目录 | ✅ done |
| 1 | RED 测试：top-level guard / room-level idempotencyKey / dispatch body 带 threadKey | pending |
| 2 | GREEN 实现 | pending |
| 3 | 全套回归 | pending |
| 4 | 回写 progress.md + walkthrough | pending |

## 6. Acceptance criteria

- [ ] `src/index.ts:608-617` 当 `registry.threadKeyFor(roomId)` 已存在时，**不**调用 `handleNaturalChatSafely`（防止 natural-chat 抢走 reply-ingest 该走的会话）
- [ ] `natural-chat` 中 `idempotencyKey` 仅依赖 `roomId`（room 级），与 `eventId` / `senderMxid` / `Date.now()` 解耦
- [ ] natural-chat 的 dispatch 请求 body 包含 `threadKey`（或等价字段），DSH web facade 可据此识别房间
- [ ] 自然对话路径继续 work：未绑 threadKey 的 room 普通消息仍走 natural-chat 并在 DSH web 出回复
- [ ] 已绑 threadKey 的 room（来自 `/agora` 路径）：非命令消息走 reply-ingest，往同一个 task 会话里灌消息
- [ ] 全套 `npm test` 通过

## 7. Worktree

- 路径：`/home/ailink/dsh-matrix-connector.worktrees/fix-room-chat-context`
- 分支：`fix/matrix-room-chat-context` (from main @ 559e303)
