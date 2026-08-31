# 2026-08-31 — Matrix room chat context continuity

## TL;DR

Element Matrix 群聊的 natural-chat 路径之前**每条消息都开新 DSH 会话**。根因有三层，已在 `dsh-matrix-connector` 一侧最小集修复——不碰 dsh-agora Core。

## Symptom

在某个 Matrix room（群）里，natural-chat 模式下用户连续发两条消息：
- 两条消息分别走两个 DSH web 会话窗口
- 第二个会话看不到第一个会话的上下文
- 用户感觉"每次都得从头讲"

## Root causes (verified)

### R1 — per-eventId idempotencyKey
`src/natural-chat.ts:145`（修复前）：
```ts
const idempotencyKey = `matrix-${eventId ?? `${roomId}:${senderMxid}:${Date.now()}`}`;
```
每条消息 eventId 都不同 → DSH web facade 看到的是"新 dispatch 实体"。

### R2 — dispatch body 不带 threadKey
`src/natural-chat.ts:71-82`（修复前）：`/dsh-agora/api/dispatch` 的 payload 里**完全没有 roomId / threadKey**。
DSH web 没有任何线索知道"这两个 dispatch 来自同一个房间"。

### R3 — 顶层 timeline 缺守卫
`src/index.ts:608-617`（修复前）：顶层 timeline 无条件进 natural-chat。
对比 `src/index.ts:678` 的 space-child 路径**已有** `!registry.threadKeyFor(roomId)` 守卫。
→ 已绑 threadKey 的 room（用户此前用过 `/agora ...` 创建过 task）被 natural-chat "抢走"，reply-ingest 走不到。

## Fix

### 改动 1 — `src/natural-chat.ts`

| 字段 | 改动 |
|---|---|
| `DshDispatchInput` | 加 `threadKey?: string` 字段（adapter-owned 不透明标识符） |
| `DshDispatchClient.dispatch` | body 增加 `...(input.threadKey ? { threadKey: input.threadKey } : {})` |
| `HandleNaturalChatOptions` | 加 `buildThreadKey: (roomId: string) => string` 必填参数 |
| `handleNaturalChat` | 用 `buildThreadKey(event.roomId)` 计算 threadKey；`idempotencyKey = matrix-${threadKey}`（room-level）；dispatch input 透传 threadKey |

**关键不变量**：
- threadKey 永远是 adapter-owned：`DshDispatchClient` 不自己造 threadKey
- idempotencyKey 不再含 eventId / senderMxid / Date.now()，只含 threadKey
- `buildThreadKey` 是必填（无默认值），所有调用方必须显式提供 → §1.5 "不留 compat shim"

### 改动 2 — `src/index.ts`

| 位置 | 改动 |
|---|---|
| `PluginOptions` | 加 `threadRegistry?: ThreadRegistry` test seam，默认 `new ThreadRegistry()` |
| `dispatchChatEvent`（line 135） | 调 `handleNaturalChat` 时注入 `buildThreadKey` |
| 顶层 timeline（line 608） | 加 `!registry.threadKeyFor(evt.roomId)` 守卫，对齐 space-child 行为 |

### 改动 3 — tests

- 新文件 `tests/room-chat-context.test.mjs`（6 tests）覆盖全部三处根因
- 更新 `tests/natural-chat.test.mjs` 和 `tests/natural-chat-wiring.test.mjs` 既有用例传 `buildThreadKey`，断言改用 room-level idempotencyKey

## Architectural invariant (after fix)

```
Matrix 顶层 timeline event
        │
        ▼
   isCommandMessage(body)?
        │
   ┌────┴────┐
   yes      no
   │         │
   ▼         ▼
 slash    registry.threadKeyFor(roomId)?
 router      │
   │       ┌──┴──┐
   │       no   yes
   │       │     │
   │       ▼     ▼
   │  natural-chat  reply-ingest
   │  (DSH web)     (/agora task)
   │  → 走新建会话   → 沿用已有 task
```

**核心规则**：
- 已绑 threadKey 的 room（被 `/agora` 路径创过 task）→ 走 reply-ingest，自然对话**沿用同一个 task 会话**
- 未绑 threadKey 的 room → 走 natural-chat，在 DSH web 里开一个新会话（这正是用户要的初次使用体验）
- 两条路径**不会同时触发同一事件**（避免上下文碎片化）

## What we did NOT touch

按 dsh-agora `AGENTS.md` §1 Core Constitution + §1.5 First-Principles Discipline：

- ❌ dsh-agora server `/api/craftsmen/dispatch` schema（threadKey 是 adapter-owned opaque，Core 不知道也不该知道）
- ❌ agora-ts 任何包
- ❌ ThreadRegistry 持久化（独立 ticket；本任务最小集不含）

## Verification

| 范围 | 结果 |
|---|---|
| 新增 6 个 RED test | 6/6 pass（GREEN） |
| 受影响 3 个测试文件 | 18/18 pass |
| 全套 unit + wiring 测试（37 文件） | **255/255 pass**，0 regress |
| smoke 测试（`*smoke*.mjs`） | 跳过（需真实 homeserver；本任务无网络依赖） |

## Files changed

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/natural-chat.ts` | M | threadKey 透传 + room-level idempotencyKey + buildThreadKey 注入 |
| `src/index.ts` | M | 顶层 timeline 守卫 + PluginOptions.threadRegistry seam + 装配 buildThreadKey |
| `tests/room-chat-context.test.mjs` | A | 6 个新 RED → GREEN test |
| `tests/natural-chat.test.mjs` | M | 既有用例补 buildThreadKey 参数 + room-level 断言 |
| `tests/natural-chat-wiring.test.mjs` | M | 同上 |
| `docs/09-PLANNING/TASKS/2026-08-31-matrix-room-chat-context/{task_plan,findings,progress}.md` | A | 任务三件套 |
| `docs/10-WALKTHROUGH/2026-08-31-matrix-room-chat-context.md` | A | 本文件 |

## Worktree

- 路径：`/home/ailink/dsh-matrix-connector.worktrees/fix-room-chat-context`
- 分支：`fix/matrix-room-chat-context` (from main @ 559e303)
- 状态：所有改动已 staged 在 worktree，等待 commit（用户未授权 commit/push）
