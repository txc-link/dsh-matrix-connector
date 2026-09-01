/**
 * natural-chat unit tests — DshDispatchClient parsing plus
 * handleNaturalChat routing (persona, text reply, optional voice,
 * error receipt).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DshDispatchClient,
  handleNaturalChat,
} from '../lib/natural-chat.js';
import { buildThreadKey } from '../lib/thread-registry.js';

function fetchStub(status, body) {
  return async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('DshDispatchClient parses a completed result envelope', async () => {
  const client = new DshDispatchClient({
    baseUrl: 'http://127.0.0.1:3080',
    timeoutMs: 30_000,
    fetchImpl: fetchStub(200, {
      ok: true,
      value: { id: 'd-1', state: 'completed', result_envelope: { answer: '你好呀' } },
    }),
  });
  const result = await client.dispatch({
    runtimeTargetRef: 'dsh:node-home-linux:default',
    prompt: 'hi',
    idempotencyKey: 'matrix-$evt',
    waitTimeoutMs: 30_000,
  });
  assert.equal(result.answer, '你好呀');
  assert.equal(result.dispatchId, 'd-1');
});

test('DshDispatchClient falls back to latest_progress message', async () => {
  const client = new DshDispatchClient({
    baseUrl: 'http://127.0.0.1:3080',
    fetchImpl: fetchStub(200, {
      ok: true,
      value: { id: 'd-2', state: 'running', latest_progress: { message: '处理中' } },
    }),
  });
  const result = await client.dispatch({
    runtimeTargetRef: 'dsh:node-mac:default',
    prompt: 'hi',
    idempotencyKey: 'k',
    waitTimeoutMs: 10_000,
  });
  assert.equal(result.answer, '处理中');
});

test('DshDispatchClient surfaces HTTP errors and missing answers', async () => {
  const client = new DshDispatchClient({
    baseUrl: 'http://127.0.0.1:3080',
    fetchImpl: fetchStub(403, { ok: false, error: { message: 'forbidden' } }),
  });
  await assert.rejects(
    () => client.dispatch({ runtimeTargetRef: 'r', prompt: 'p', idempotencyKey: 'k', waitTimeoutMs: 1000 }),
    /forbidden/,
  );
  const empty = new DshDispatchClient({
    baseUrl: 'http://127.0.0.1:3080',
    fetchImpl: fetchStub(200, { ok: true, value: { id: 'd-3', state: 'failed' } }),
  });
  await assert.rejects(
    () => empty.dispatch({ runtimeTargetRef: 'r', prompt: 'p', idempotencyKey: 'k', waitTimeoutMs: 1000 }),
    /without an answer/,
  );
});

function makeDelivery(overrides = {}) {
  const sent = [];
  const voiceDeliveries = [];
  const logs = [];
  return {
    sent,
    voiceDeliveries,
    logs,
    delivery: {
      matrix: {
        sendText: async (roomId, body) => { sent.push({ roomId, body }); },
      },
      voiceDelivery: {
        deliver: async (input) => { voiceDeliveries.push(input); return { eventId: 'v1' }; },
      },
      sourceDomain: 'companion:xiaozhi',
      logger: (...args) => logs.push(args),
      ...overrides,
    },
  };
}

const config = {
  enabled: true,
  dshApiBaseUrl: 'http://127.0.0.1:3080',
  runtimeTargetRef: 'dsh:node-home-linux:default',
  waitTimeoutMs: 30_000,
  personas: { '!gf:hs': '你是小栀，温柔体贴的虚拟女友。' },
  voice: true,
};

test('handleNaturalChat: disabled or empty body is skipped', async () => {
  const { delivery, sent } = makeDelivery();
  const outcome = await handleNaturalChat({
    config: { ...config, enabled: false },
    dispatch: async () => ({ answer: 'x', dispatchId: 'd' }),
    event: { roomId: '!r:hs', senderMxid: '@u:hs', body: 'hi' },
    delivery,
  });
  assert.equal(outcome.status, 'disabled');
  assert.equal(sent.length, 0);
});

test('handleNaturalChat: persona is prepended and reply is sent', async () => {
  const { delivery, sent, voiceDeliveries } = makeDelivery();
  const seen = [];
  const outcome = await handleNaturalChat({
    config,
    dispatch: async (input) => { seen.push(input); return { answer: '我也想你', dispatchId: 'd-9' }; },
    event: { roomId: '!gf:hs', senderMxid: '@root:hs', body: '今天想你了', eventId: '$e1' },
    delivery,
    buildThreadKey,
  });
  assert.equal(outcome.status, 'replied');
  assert.equal(seen.length, 1);
  assert.match(seen[0].prompt, /你是小栀/);
  assert.match(seen[0].prompt, /今天想你了/);
  assert.equal(seen[0].idempotencyKey, 'matrix-event-$e1');
  assert.deepEqual(sent, [{ roomId: '!gf:hs', body: '我也想你' }]);
  assert.equal(voiceDeliveries.length, 1);
  assert.equal(voiceDeliveries[0].roomId, '!gf:hs');
  assert.equal(voiceDeliveries[0].purpose, 'companion_chat');
});

test('handleNaturalChat: voice failure never suppresses the text reply', async () => {
  const { delivery, sent } = makeDelivery({
    voiceDelivery: { deliver: async () => { throw new Error('tts down'); } },
  });
  const outcome = await handleNaturalChat({
    config,
    dispatch: async () => ({ answer: '好的', dispatchId: 'd' }),
    event: { roomId: '!gf:hs', senderMxid: '@root:hs', body: 'ok' },
    delivery,
    buildThreadKey,
  });
  assert.equal(outcome.status, 'replied');
  assert.equal(sent[0].body, '好的');
});

test('handleNaturalChat: dispatch failure sends an honest error receipt', async () => {
  const { delivery, sent, logs } = makeDelivery();
  const outcome = await handleNaturalChat({
    config,
    dispatch: async () => { throw new Error('agent unavailable'); },
    event: { roomId: '!gf:hs', senderMxid: '@root:hs', body: 'hi' },
    delivery,
    buildThreadKey,
  });
  assert.equal(outcome.status, 'error');
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /agent 响应失败：agent unavailable/);
  assert.ok(logs.length >= 1);
});

test('handleNaturalChat: rooms allow-list restricts chat to selected rooms', async () => {
  const seen = [];
  const { delivery, sent } = makeDelivery();
  const outcome = await handleNaturalChat({
    config: { ...config, rooms: ['!gf:hs'] },
    dispatch: async (input) => { seen.push(input); return { answer: 'x', dispatchId: 'd' }; },
    event: { roomId: '!other:hs', senderMxid: '@root:hs', body: 'hi' },
    delivery,
  });
  assert.equal(outcome.status, 'skipped');
  assert.equal(seen.length, 0);
  assert.equal(sent.length, 0);
});
