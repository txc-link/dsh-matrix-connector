# Findings

- `message-router.ts` 只解析 `/agora` 动词；`natural-chat.ts` 将普通消息交给单一 DSH target。
- 绑定任务房间的普通消息已通过 `reply-ingest` 写入 Core conversation；该链路应继续保持，不在 Connector 本地保存任务状态。
- 新的点名和轮次信息应作为 adapter 侧 dispatch intent/metadata，Core 负责最终授权和编排。
