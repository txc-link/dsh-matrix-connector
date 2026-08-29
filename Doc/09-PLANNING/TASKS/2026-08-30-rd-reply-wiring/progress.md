# R-D reply wiring — Progress (2026-08-30)

## 状态

✅ **完成** — timeline listener 接线（transport → client → plugin apply → ingestMatrixReply）

## 验证

- reply-wiring.test.mjs: 3/3（dispatch 绑定→reply 入 agora / 非 message+own+未绑定跳过 / own sender 跳过）
- 全量回归: 175+3 pass / 0 fail
- build: 0 / typecheck: 0

## 变更

| 文件 | 角色 |
|---|---|
| `src/matrix-client.ts` | MatrixTransport +onTimelineEvent?；MatrixTimelineEvent 类型；MatrixClient.onTimelineEvent 透传 |
| `src/transport/matrix-js-sdk.ts` | onTimelineEvent 实现（matrix-js-sdk RoomEvent.Timeline；isOwn=sender===userId） |
| `src/thread-registry.ts` | +threadKeyFor(roomId) 反查 |
| `src/index.ts` | apply() 注册 timeline handler → ingestMatrixReply |
| `tests/reply-wiring.test.mjs` | 3 集成测试 |

## R-D 全链路（最终形态）

```
人类在任务房间回复 (m.relates_to.m.in_reply_to)
  → matrix-js-sdk /sync timeline
    → MatrixJsSdkTransport.onTimelineEvent        [本 PR]
      → MatrixClient.onTimelineEvent               [本 PR]
        → plugin apply() timeline handler          [本 PR]
          → ingestMatrixReply (threadKeyOf/taskIdOf)  [PR#5]
            → agora.recordInboundReply               [PR#5]
              → POST /api/tasks/:id/conversation/reply  [PR#15]
                → InboxReplyService                   [PR#14]
                  → task_conversation_entries (migration 035)
```

## 下一候选

- 真实 homeserver smoke（dev machine，agent-hub.local:8008）
- R-E Space 嵌套 / R-F web 详情面板（均延后）