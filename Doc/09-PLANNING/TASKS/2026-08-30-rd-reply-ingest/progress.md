# R-D matrix side — Progress (2026-08-30)

## 状态

✅ **reply ingest 完成**（agora-rest 方法 + ingestMatrixReply 纯函数）
⏳ timeline listener 接线（宿主 plugin apply()，R-B 范围外）

## 验证

- reply-ingest.test.mjs: 5/5
- agora-rest.test.mjs: +2（recordInboundReply）
- 全量回归: 173/173
- build: 0 / typecheck: 0

## 变更

| 文件 | 角色 |
|---|---|
| `src/agora-rest.ts` | +recordInboundReply(taskId, input) 方法 |
| `src/reply-ingest.ts` | **新增** ingestMatrixReply 纯函数 |
| `src/index.ts` | export |
| `tests/reply-ingest.test.mjs` | 5 测试 |
| `tests/agora-rest.test.mjs` | +2 测试 |

## R-D 全链路状态

- ✅ dsh-agora PR#14: InboxReplyService（Core 抽象）
- ✅ dsh-agora PR#15: POST /api/tasks/:id/conversation/reply（REST 入口）
- ✅ **本 PR**: agora-rest.recordInboundReply + ingestMatrixReply（matrix side 解析）
- ⏳ 宿主接线: matrix-js-sdk onEvent → ingestMatrixReply（plugin apply()）

## 交付形态

```ts
// 宿主 plugin apply() 内（future）
client.onEvent(async (event) => {
  if (event.type === 'm.room.message' && !isOwnMessage(event.sender)) {
    await ingestMatrixReply({
      agora,
      threadKeyOf: (roomId) => registry.threadKeyFor(roomId),
      taskIdOf: (threadKey) => bindingCache.get(threadKey),
      event,
      occurredAt: new Date(event.origin_server_ts).toISOString(),
    });
  }
});
```