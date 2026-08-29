/**
 * reply-ingest.ts — R-D inbound reply ingestion (matrix side).
 *
 * §1 boundary: this adapter module knows matrix event shape
 * (m.relates_to.m.in_reply_to) and translates it to opaque fields the
 * agora Core accepts. agora central never sees matrix vocabulary.
 */

export interface MatrixReplyEvent {
  roomId: string;
  eventId: string;
  sender: string;
  body: string;
  relatesTo?: { inReplyTo?: { eventId?: string } };
}

export interface ReplyIngestAgora {
  recordInboundReply(
    taskId: string,
    input: {
      provider: string;
      provider_message_ref: string;
      parent_message_ref?: string;
      body: string;
      author_kind: 'human' | 'agent' | 'craftsman' | 'system';
      author_ref?: string;
      display_name?: string;
      occurred_at: string;
      thread_task_binding_key?: string;
    },
  ): Promise<{ id: string; deduped: boolean }>;
}

export interface IngestMatrixReplyOptions {
  agora: ReplyIngestAgora;
  /** roomId → opaque threadKey (thread-registry.buildThreadKey) */
  threadKeyOf: (roomId: string) => string | undefined;
  /** threadKey → taskId (agora thread binding lookup) */
  taskIdOf: (threadKey: string) => string | undefined;
  event: MatrixReplyEvent;
  /** ISO timestamp of the event (adapter-supplied) */
  occurredAt?: string;
}

export async function ingestMatrixReply(
  options: IngestMatrixReplyOptions,
): Promise<{ status: 'ingested' | 'skipped' }> {
  const { agora, threadKeyOf, taskIdOf, event, occurredAt } = options;

  const threadKey = threadKeyOf(event.roomId);
  if (!threadKey) return { status: 'skipped' };

  const taskId = taskIdOf(threadKey);
  if (!taskId) return { status: 'skipped' };

  const body = event.body.trim();
  if (!body) return { status: 'skipped' };

  await agora.recordInboundReply(taskId, {
    provider: 'matrix',
    provider_message_ref: event.eventId,
    ...(event.relatesTo?.inReplyTo?.eventId
      ? { parent_message_ref: event.relatesTo.inReplyTo.eventId }
      : {}),
    body,
    author_kind: 'human',
    author_ref: event.sender,
    occurred_at: occurredAt ?? new Date().toISOString(),
    thread_task_binding_key: threadKey,
  });
  return { status: 'ingested' };
}
