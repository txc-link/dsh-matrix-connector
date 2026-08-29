# R-D matrix side — Findings (2026-08-30)

## 1. 现实校准：matrix-connector 无 timeline listener

matrix-connector 是 **slash command bridge**（message-router 只处理
@citizen/@task/@pull 等 verb），没有 timeline 事件监听主循环。

R-D 的"人类在任务房间自由文本回复"不是 verb 命令 —— 是 timeline event。
完整 listener 是**新架构件**（R-B 范围外），属于宿主 plugin apply() 的职责。

**本 PR 交付可复用的 ingest 函数**，listener 接线由宿主完成：
- `ingestMatrixReply({ agora, threadKeyOf, taskIdOf, event })` — 纯编排
- agora-rest.recordInboundReply — REST 转发

## 2. §1 boundary

`reply-ingest.ts` 是 adapter 模块，**知道** matrix event shape
（m.relates_to.m.in_reply_to），把它翻译成 agora Core 接受的 opaque 字段：
- `provider_message_ref` ← event_id
- `parent_message_ref` ← m.in_reply_to.event_id（opaque parent anchor）
- `thread_task_binding_key` ← thread-registry.buildThreadKey(roomId)
- `author_ref` ← sender mxid

agora Core 永远看不到 matrix 词汇 —— R-D 闭环，§1 合规。

## 3. 解析逻辑

```
ingestMatrixReply(event):
  threadKey = threadKeyOf(roomId)     // thread-registry buildThreadKey
  if !threadKey → skipped             // 非任务房间
  taskId = taskIdOf(threadKey)        // agora thread binding lookup
  if !taskId → skipped                // 未绑定的 thread
  body = event.body.trim()
  if !body → skipped                  // 空消息
  agora.recordInboundReply(taskId, {
    provider: 'matrix',
    provider_message_ref: event.eventId,
    parent_message_ref?: event.relatesTo.inReplyTo.eventId,  // 可选
    body,
    author_kind: 'human',
    author_ref: event.sender,
    occurred_at,
    thread_task_binding_key: threadKey,
  })
```

## 4. 测试覆盖

| suite | tests | 覆盖 |
|---|---|---|
| reply-ingest.test.mjs | 5 | 主链路 / 无 thread binding / 无 task / 空 body / 非 reply-to |
| agora-rest.test.mjs | +2 | recordInboundReply POST 转发 / optional parent 省略 |

## 5. 未决

- ❌ timeline listener 接线（宿主 plugin apply()：matrix-js-sdk onEvent →
  ingestMatrixReply）
- ❌ taskIdOf 的来源（宿主需有 threadKey→taskId 映射；dsh-agora
  threadTaskBindingService.getByThreadKey 查询或 adapter 侧缓存）