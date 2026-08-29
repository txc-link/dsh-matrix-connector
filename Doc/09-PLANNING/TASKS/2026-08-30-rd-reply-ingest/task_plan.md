# R-D matrix side — reply ingest (2026-08-30)

## 1. 目标

matrix adapter 把人类在任务房间的**自由文本回复**投递到 agora
`POST /api/tasks/:id/conversation/reply`（PR#15）。

## 2. 范围

### 必须
1. `src/agora-rest.ts` — `recordInboundReply(taskId, input)` 方法
2. `src/reply-ingest.ts` — 纯函数 `ingestMatrixReply({ agora, taskId?, roomId, event, threadRegistry })`:
   - 解析 matrix event payload（m.relates_to.m.in_reply_to → parentMessageRef）
   - roomId → threadTaskBindingKey（thread-registry buildThreadKey）
   - 调 agora.recordInboundReply
3. tests: agora-rest 方法转发 + reply-ingest 解析逻辑
4. doc

### 不做
- ❌ timeline listener 接线（宿主 plugin apply() 提供事件源；本 PR 只给 ingest 函数）
- ❌ 任务房间识别（roomId→taskId 映射靠 thread-registry 已有 binding；无 binding 则跳过）

## 3. 设计

```ts
// src/reply-ingest.ts
export interface MatrixReplyEvent {
  roomId: string;
  eventId: string;
  sender: string;
  body: string;
  relatesTo?: { inReplyTo?: { eventId?: string } };  // m.relates_to.m.in_reply_to
}

export async function ingestMatrixReply(opts: {
  agora: Pick<AgoraRestClient, 'recordInboundReply'>;
  threadKeyOf?: (roomId: string) => string | undefined;  // thread-registry
  taskIdOf?: (threadKey: string) => string | undefined;  // thread binding
  event: MatrixReplyEvent;
}): Promise<{ status: 'ingested' | 'skipped' }>
```

- 无 thread binding → skipped
- 无 body → skipped
- m.in_reply_to.event_id → parentMessageRef (opaque)
- author = sender mxid (opaque)

## 4. worktree

- path: `.repos/wt-rd-reply-ingest/`
- branch: `feat/rd-reply-ingest` (base main `32e6e14`)

## 5. 验证

- node --test: agora-rest + reply-ingest suites
- build 0 / typecheck 0
- 全量回归 166+ (0 回归)