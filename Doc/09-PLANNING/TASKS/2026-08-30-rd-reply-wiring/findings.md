# R-D reply wiring — Findings (2026-08-30)

## 1. 关键发现：宿主无 matrix 事件源，插件自接

DSH 宿主（/opt/self-manager/dsh）**没有** matrix.room.message 事件 ——
宿主本身无 matrix 接入。`matrix.room.message` 是 dsh-matrix-connector
插件内部约定的**宿主事件通道**（外部宿主未来可发），但**真实 timeline
事件源必须由插件自己从 matrix-js-sdk 拉**。

本 PR 让插件直接订阅 matrix-js-sdk timeline：
`MatrixTransport.onTimelineEvent` → matrix-js-sdk RoomEvent.Timeline。

## 2. 接线链路（§1 全程合规）

```
matrix-js-sdk /sync timeline
  → MatrixJsSdkTransport.onTimelineEvent      [transport 层]
    → MatrixClient.onTimelineEvent             [client 层]
      → plugin apply() timeline handler        [index.ts]
        → ingestMatrixReply                    [reply-ingest.ts, PR#5]
          → agora.recordInboundReply           [agora-rest.ts, PR#5]
            → POST /api/tasks/:id/conversation/reply  [PR#15]
              → InboxReplyService              [PR#14]
```

matrix 协议 shape（m.relates_to.m.in_reply_to）只在 transport + wiring
侧出现；agora Core 只见 opaque provider_message_ref / parent_message_ref /
thread_task_binding_key。

## 3. 设计决策

### 3.1 transport 事件 surface 为什么是"原始 matrix 事件"

`MatrixTimelineEvent` 带 matrix 词汇（relatesTo.inReplyTo.eventId）——
**故意的**：transport 是 adapter 最底层，负责协议翻译。翻译成 opaque
字段发生在 wiring（ingestMatrixReply），不让 matrix 词汇漏进 Core。

### 3.2 自己消息过滤

matrix-js-sdk 的 RoomEvent.Timeline 会回显自己发送的事件。
wiring 层 filter：
- `evt.type !== 'm.room.message'` → skip（state/redaction 等）
- `evt.isOwn` → skip（自己发的 placeholder/panel 编辑）

### 3.3 ThreadRegistry.threadKeyFor 反查

绑定是 threadKey → { roomId, taskId } 单向。reply 需要 roomId → threadKey
反查，新增 `threadKeyFor(roomId)`（线性扫描，bindings 量小可接受）。

### 3.4 事件源二选一

- `matrix.room.message`（宿主通道）→ slash 命令处理（既有）
- `onTimelineEvent`（插件自接）→ reply ingest（新增）

两者并存：slash 命令走宿主通道（保持向后兼容），自由文本回复走
timeline。宿主未来若提供真实 timeline 事件，onTimelineEvent 可废弃。

## 4. 测试覆盖

| suite | tests | 覆盖 |
|---|---|---|
| reply-wiring.test.mjs | 2 | dispatch 绑定→reply 入 agora 全链路 / 非 message、own、未绑定跳过 |

## 5. 未决

- ❌ 真实 homeserver smoke：沙箱无法访问 agent-hub.local:8008，留 dev machine
- ✅ isOwn：transport 层填（sender === opts.userId），wiring 保留 filter