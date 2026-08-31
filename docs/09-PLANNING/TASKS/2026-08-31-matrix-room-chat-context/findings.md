# Findings

## A. 故障路径不是 dsh-agora Core，而是 DSH web 本地 facade

- natural-chat 调本地 DSH web `http://127.0.0.1:3080/dsh-agora/api/dispatch`（src/natural-chat.ts:72）
- dsh-agora server 的 `/api/craftsmen/dispatch`（dist/app.js:4150）接的是 `craftsmanDispatchRequestSchema`，语义是"派 craftsman 执行 task 子步"，**完全不同的概念**
- threadKey 在 `/api/tasks/:id/conversation/reply`（dist/app.js:5873）作为 inbound reply 的 binding key 出现——这条路径 reply-ingest 已经在用，但 natural-chat 不走这条路

结论：**故障面在 dsh-matrix-connector 一侧**，不需要且不允许改 dsh-agora server。

## B. dsh-agora Core 的硬约束（已在 dist/app.js 注释中固化）

> "Payload MUST NOT include any IM-specific key (threadKey / room_id); those are adapter-owned opaque identifiers."

这意味着 threadKey 永远不会出现在 dsh-agora server 的契约里。connector 必须在自己内部管理 room ↔ session 的关系。

## C. 现有 registry 行为（src/thread-registry.ts）

- `buildThreadKey(roomId)` = `mx_<sha256(roomId)[:16]>`——同一 roomId 永远返回同一个 threadKey
- `threadKeyFor(roomId)` 反向查找（v0.5 起）
- 这是 natural-chat 路径**可以复用** threadKey 的依据——只要在装配时把 `registry` 传进去即可

## D. space-child 路径为什么没问题

`src/index.ts:678` 已有守卫：
```ts
if (chatConfig.enabled && !registry.threadKeyFor(evt.childRoomId)) {
  handleNaturalChatSafely({ ... });
}
```

——已绑 threadKey 的 child room 走 reply-ingest（692 行），未绑的才走 natural-chat。**顶层 timeline 路径漏写了同样的守卫**（608-617 行无条件进 natural-chat）。

## E. 测试基础设施

- 测试文件已用 `.mjs` 风格（tests/*.test.mjs）
- 自然对话已有 `tests/natural-chat.test.mjs` + `tests/natural-chat-wiring.test.mjs`
- 顶层 timeline 守卫需要测 index.ts 里的 `matrix.onTimelineEvent` 回调，这块之前没单测，需要新加一个 fake matrix client 模拟顶层 timeline 事件
