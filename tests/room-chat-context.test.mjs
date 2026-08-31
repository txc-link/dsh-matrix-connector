/**
 * room-chat-context — RED tests for the "same room reuses the same DSH web
 * session" requirement.
 *
 * Bug: natural-chat emitted a per-eventId idempotencyKey, so every message
 * in the same room was treated as a brand new DSH session. Top-level
 * timeline events were also unconditionally routed through natural-chat,
 * competing with the reply-ingest path that /agora commands established.
 *
 * After fix:
 *   - idempotencyKey is room-level (driven by the opaque threadKey)
 *   - dispatch body carries threadKey so DSH web facade can link the room
 *   - top-level timeline events skip natural-chat when a threadKey binding
 *     already exists for the room (space-child behaviour at index.ts:678
 *     is now symmetric for top-level rooms at index.ts:608)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  DshDispatchClient,
  handleNaturalChat,
} from '../lib/natural-chat.js';
import { createMatrixConnectorPlugin } from '../lib/index.js';
import { MatrixClient } from '../lib/matrix-client.js';
import { buildThreadKey, ThreadRegistry } from '../lib/thread-registry.js';

// ───────────────────────── natural-chat: threadKey pass-through ─────────────────────────

function fetchRecording(body) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, value: { id: 'd-1', state: 'completed', answer: 'ok' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fn, calls };
}

test('DshDispatchClient forwards threadKey in the dispatch body', async () => {
  const { fn, calls } = fetchRecording();
  const client = new DshDispatchClient({ baseUrl: 'http://127.0.0.1:3080', fetchImpl: fn });
  await client.dispatch({
    runtimeTargetRef: 'dsh:node-a:default',
    prompt: 'hi',
    idempotencyKey: 'matrix-mx_abc',
    threadKey: 'mx_abc',
    waitTimeoutMs: 1000,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.threadKey, 'mx_abc');
  assert.equal(calls[0].body.idempotencyKey, 'matrix-mx_abc');
});

test('handleNaturalChat: idempotencyKey is room-level, independent of eventId', async () => {
  const seen = [];
  const outcome = await handleNaturalChat({
    config: {
      enabled: true,
      dshApiBaseUrl: 'http://127.0.0.1:3080',
      runtimeTargetRef: 'dsh:node-a:default',
      waitTimeoutMs: 1000,
    },
    dispatch: async (input) => { seen.push(input); return { answer: 'ok', dispatchId: 'd' }; },
    event: { roomId: '!room:hs', senderMxid: '@u:hs', body: 'first', eventId: '$evt-1' },
    delivery: {
      matrix: { sendText: async () => {} },
      logger: () => {},
    },
    buildThreadKey,
  });
  assert.equal(outcome.status, 'replied');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].idempotencyKey, `matrix-${buildThreadKey('!room:hs')}`);
  // threadKey must be passed through to the dispatch input
  assert.equal(seen[0].threadKey, buildThreadKey('!room:hs'));
});

test('handleNaturalChat: two events in the same room share idempotencyKey', async () => {
  const seen = [];
  const dispatch = async (input) => { seen.push(input); return { answer: 'ok', dispatchId: 'd' }; };
  const delivery = { matrix: { sendText: async () => {} }, logger: () => {} };
  const config = {
    enabled: true,
    dshApiBaseUrl: 'http://127.0.0.1:3080',
    runtimeTargetRef: 'dsh:node-a:default',
    waitTimeoutMs: 1000,
  };
  await handleNaturalChat({
    config,
    dispatch,
    event: { roomId: '!same:hs', senderMxid: '@u:hs', body: 'msg 1', eventId: '$evt-a' },
    delivery,
    buildThreadKey,
  });
  await handleNaturalChat({
    config,
    dispatch,
    event: { roomId: '!same:hs', senderMxid: '@u:hs', body: 'msg 2', eventId: '$evt-b' },
    delivery,
    buildThreadKey,
  });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].idempotencyKey, seen[1].idempotencyKey,
    'same roomId MUST yield identical idempotencyKey across events');
  // sanity: bodies did change, proving we did dispatch twice
  assert.match(seen[0].prompt, /msg 1/);
  assert.match(seen[1].prompt, /msg 2/);
  // threadKey also identical
  assert.equal(seen[0].threadKey, seen[1].threadKey);
});

// ───────────────────────── wiring: top-level timeline guard ─────────────────────────

function makeHarness(chatDispatcher, registry) {
  let timelineHandler = null;
  const sent = [];
  const transport = {
    sendRoomMessage: async (msg) => { sent.push(msg); return { eventId: `out_${sent.length}`, roomId: msg.roomId }; },
    editRoomMessage: async (roomId, eventId) => ({ eventId: `${eventId}_e`, roomId }),
    uploadBytes: async () => ({ mxcUri: 'mxc://hs/1', sizeBytes: 1 }),
    startSync: () => {},
    stopSync: async () => {},
    joinedMembers: async () => ['@dsh-bridge-node-a:agent-hub.local'],
    onTimelineEvent(handler) { timelineHandler = handler; },
  };
  const agora = {
    health: async () => ({ status: 'ok' }),
    listTemplates: async () => [],
    listTasks: async () => [],
    getTask: async () => null,
    createTask: async () => ({ id: 'task_1' }),
    listProjects: async () => ({ projects: [] }),
    getProject: async () => ({}),
    searchBrain: async () => [],
    listArtifacts: async () => [],
    getArtifact: async () => ({}),
    getArtifactContent: async () => ({ artifact_id: 'a', bytes: new Uint8Array([1]), media_type: 'text/plain', name: 'a' }),
    listCitizens: async () => [],
    getCitizen: async () => ({}),
    getArtifactBytes: async () => ({ bytes: new Uint8Array([1]), name: 'a', mediaType: 'text/plain' }),
    pollEvents: async () => ({ events: [], nextSince: 0 }),
    streamEvents: async () => ({ ok: true, body: null }),
    recordInboundReply: async () => ({ id: 'rc-1', deduped: false }),
  };
  return {
    timelineHandler: () => timelineHandler,
    sent,
    agora,
    transport,
    client: new MatrixClient(transport),
    registry,
  };
}

function makeContext() {
  const listeners = new Map();
  const effects = [];
  const disposes = [];
  return {
    context: {
      on(event, handler) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(handler);
      },
      effect(fn) {
        effects.push(() => {
          const dispose = fn(() => {});
          if (typeof dispose === 'function') disposes.push(dispose);
        });
      },
      logger(...args) { /* noop */ },
    },
    emit(event, payload) {
      for (const h of listeners.get(event) ?? []) h(payload);
    },
    runEffects() {
      for (const f of effects) f();
    },
    cleanup() {
      while (disposes.length > 0) {
        const d = disposes.pop();
        try { d(); } catch { /* ignore */ }
      }
    },
  };
}

function buildPlugin(harness, ctx, chatDispatcher, registry, configOverrides = {}) {
  const plugin = createMatrixConnectorPlugin({
    config: {
      homeserverUrl: 'http://hs:8008',
      accessToken: 'syt_x',
      userId: '@bot:agent-hub.local',
      agoraServerUrl: 'http://agora:8080',
      agoraApiToken: 'token',
      nodeId: 'node-a',
      commandName: 'agora',
      requestTimeoutMs: 10000,
      autoJoin: true,
      eventPollIntervalMs: 5000,
      ...configOverrides,
    },
    matrixClient: harness.client,
    agora: harness.agora,
    context: ctx.context,
    chatDispatcher,
    threadRegistry: registry,
  });
  plugin.apply(ctx.context);
  ctx.runEffects();
  return ctx;
}

const tick = () => new Promise((r) => setTimeout(r, 30));

test('top-level timeline: bound room does NOT invoke natural-chat (guarded)', async () => {
  const seen = [];
  const dispatcher = async (input) => { seen.push(input); return { answer: 'no', dispatchId: 'd' }; };
  const registry = new ThreadRegistry();
  // Pre-seed a threadKey binding for !bound:hs as if /agora had been used
  registry.upsertPlaceholder(buildThreadKey('!bound:hs'), '!bound:hs', '$placeholder', 'task_99');
  const harness = makeHarness(dispatcher, registry);
  const ctx = buildPlugin(harness, makeContext(), dispatcher, registry, {
    chat: { enabled: true, runtimeTargetRef: 'dsh:node-a:default' },
  });

  harness.timelineHandler()({
    roomId: '!bound:hs',
    eventId: '$plain-bound',
    sender: '@root:hs',
    type: 'm.room.message',
    body: '普通消息',
  });
  await tick();

  // The chat dispatcher MUST NOT fire for rooms that already have an
  // /agora task binding — that conversation already has its own DSH
  // session via reply-ingest.
  assert.equal(seen.length, 0, 'bound rooms must skip natural-chat');
  ctx.cleanup();
});

test('top-level timeline: unbound room DOES invoke natural-chat with threadKey', async () => {
  const seen = [];
  const dispatcher = async (input) => { seen.push(input); return { answer: 'ok', dispatchId: 'd' }; };
  const registry = new ThreadRegistry();
  const harness = makeHarness(dispatcher, registry);
  const ctx = buildPlugin(harness, makeContext(), dispatcher, registry, {
    chat: { enabled: true, runtimeTargetRef: 'dsh:node-a:default' },
  });

  harness.timelineHandler()({
    roomId: '!new:hs',
    eventId: '$plain-new',
    sender: '@root:hs',
    type: 'm.room.message',
    body: '新房间第一条',
  });
  await tick();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].threadKey, buildThreadKey('!new:hs'));
  assert.equal(seen[0].idempotencyKey, `matrix-${buildThreadKey('!new:hs')}`);
  ctx.cleanup();
});

test('top-level timeline: same unbound room → two events → identical idempotencyKey', async () => {
  const seen = [];
  const dispatcher = async (input) => { seen.push(input); return { answer: 'ok', dispatchId: 'd' }; };
  const registry = new ThreadRegistry();
  const harness = makeHarness(dispatcher, registry);
  const ctx = buildPlugin(harness, makeContext(), dispatcher, registry, {
    chat: { enabled: true, runtimeTargetRef: 'dsh:node-a:default' },
  });

  const handler = harness.timelineHandler();
  handler({ roomId: '!c:hs', eventId: '$a', sender: '@u', type: 'm.room.message', body: '一' });
  await tick();
  handler({ roomId: '!c:hs', eventId: '$b', sender: '@u', type: 'm.room.message', body: '二' });
  await tick();

  assert.equal(seen.length, 2);
  assert.equal(seen[0].idempotencyKey, seen[1].idempotencyKey);
  ctx.cleanup();
});
