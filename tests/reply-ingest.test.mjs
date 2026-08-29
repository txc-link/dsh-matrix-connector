/**
 * reply-ingest.test.mjs — RED-first unit tests for ingestMatrixReply.
 *
 * §1 boundary: pure orchestration. Parses matrix event payload (opaque
 * m.relates_to), resolves thread binding, calls agora.recordInboundReply.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ingestMatrixReply } from '../lib/reply-ingest.js';

function stubAgora() {
  const calls = [];
  return {
    calls,
    recordInboundReply: async (taskId, input) => {
      calls.push({ taskId, input });
      return { id: 'rc-1', deduped: false };
    },
  };
}

function makeEvent(overrides = {}) {
  return {
    roomId: '!abc:agent-hub.local',
    eventId: '$evt-2',
    sender: '@alice:agent-hub.local',
    body: '我来处理',
    relatesTo: { inReplyTo: { eventId: '$evt-1' } },
    ...overrides,
  };
}

test('reply-ingest: ingests a reply with parent link', async () => {
  const agora = stubAgora();
  const result = await ingestMatrixReply({
    agora,
    threadKeyOf: () => 'mx_abc123',
    taskIdOf: () => 'T-42',
    event: makeEvent(),
    occurredAt: '2026-08-30T12:00:00.000Z',
  });
  assert.equal(result.status, 'ingested');
  assert.equal(agora.calls.length, 1);
  assert.equal(agora.calls[0].taskId, 'T-42');
  assert.deepEqual(agora.calls[0].input, {
    provider: 'matrix',
    provider_message_ref: '$evt-2',
    parent_message_ref: '$evt-1',
    body: '我来处理',
    author_kind: 'human',
    author_ref: '@alice:agent-hub.local',
    occurred_at: '2026-08-30T12:00:00.000Z',
    thread_task_binding_key: 'mx_abc123',
  });
});

test('reply-ingest: skipped when no thread binding', async () => {
  const agora = stubAgora();
  const result = await ingestMatrixReply({
    agora,
    threadKeyOf: () => undefined,
    taskIdOf: () => 'T-42',
    event: makeEvent(),
  });
  assert.equal(result.status, 'skipped');
  assert.equal(agora.calls.length, 0);
});

test('reply-ingest: skipped when no task for thread key', async () => {
  const agora = stubAgora();
  const result = await ingestMatrixReply({
    agora,
    threadKeyOf: () => 'mx_abc123',
    taskIdOf: () => undefined,
    event: makeEvent(),
  });
  assert.equal(result.status, 'skipped');
  assert.equal(agora.calls.length, 0);
});

test('reply-ingest: skipped on empty body', async () => {
  const agora = stubAgora();
  const result = await ingestMatrixReply({
    agora,
    threadKeyOf: () => 'mx_abc123',
    taskIdOf: () => 'T-42',
    event: makeEvent({ body: '' }),
  });
  assert.equal(result.status, 'skipped');
  assert.equal(agora.calls.length, 0);
});

test('reply-ingest: parent_message_ref omitted when not a reply-to', async () => {
  const agora = stubAgora();
  const result = await ingestMatrixReply({
    agora,
    threadKeyOf: () => 'mx_abc123',
    taskIdOf: () => 'T-42',
    event: makeEvent({ relatesTo: undefined }),
  });
  assert.equal(result.status, 'ingested');
  assert.equal(agora.calls[0].input.parent_message_ref, undefined);
});
