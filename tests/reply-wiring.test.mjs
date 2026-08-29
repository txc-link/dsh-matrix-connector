/**
 * reply-wiring.test.mjs — R-D reply ingest wiring integration test.
 *
 * Verifies the plugin apply() wires matrix timeline events (m.room.message
 * with m.relates_to.m.in_reply_to) through ingestMatrixReply into the
 * agora recordInboundReply call, for rooms already bound to a task
 * (via /agora dispatch on the matrix.room.message channel).
 *
 * §1 boundary: the wiring translates matrix protocol shape into opaque
 * fields; agora stub receives provider_message_ref / parent_message_ref /
 * thread_task_binding_key — no matrix vocabulary.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMatrixConnectorPlugin } from '../lib/index.js';
import { MatrixClient } from '../lib/matrix-client.js';

function makeContext() {
  const listeners = new Map();
  const effects = [];
  const disposes = [];
  const logs = [];
  return {
    listeners,
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
      logger(...args) { logs.push(args); },
    },
    emit(event, payload) {
      const handlers = listeners.get(event);
      if (!handlers) return;
      for (const h of handlers) h(payload);
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

function makeWiringHarness() {
  let timelineHandler = null;
  const replied = [];
  const sent = [];
  const transport = {
    sendRoomMessage: async (msg) => {
      sent.push(msg);
      return { eventId: `evt_out_${sent.length}`, roomId: msg.roomId };
    },
    editRoomMessage: async (roomId, eventId) => ({ eventId: `${eventId}_e`, roomId, replaced: true }),
    uploadBytes: async () => ({ mxcUri: 'mxc://hs/1', sizeBytes: 1 }),
    startSync: () => {},
    stopSync: async () => {},
    joinedMembers: async () => ['@dsh-bridge-node-a:agent-hub.local'],
    onTimelineEvent(handler) {
      timelineHandler = handler;
    },
  };
  const agora = {
    health: async () => ({ status: 'ok' }),
    listTemplates: async () => [],
    listTasks: async () => [],
    getTask: async () => null,
    createTask: async (i) => ({ id: 'task_1', state: 'pending', type: i.type, title: i.title, creator: i.creator }),
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
    recordInboundReply: async (taskId, input) => {
      replied.push({ taskId, input });
      return { id: 'rc-1', deduped: false };
    },
  };
  return {
    timelineHandler: () => timelineHandler,
    replied,
    sent,
    agora,
    transport,
    client: new MatrixClient(transport),
  };
}

function buildPlugin(harness, ctx) {
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
    },
    matrixClient: harness.client,
    agora: harness.agora,
    context: ctx.context,
  });
  plugin.apply(ctx.context);
  ctx.runEffects();
  return ctx;
}

const tick = () => new Promise((r) => setTimeout(r, 30));

test('reply-wiring: dispatch binds a room, then a reply ingests into agora', async (t) => {
  const harness = makeWiringHarness();
  const ctx = makeContext();
  t.after(() => ctx.cleanup());
  buildPlugin(harness, ctx);

  const handler = harness.timelineHandler();
  assert.ok(typeof handler === 'function', 'timeline handler registered');

  // 1) dispatch via matrix.room.message channel (host event) — binds room
  ctx.emit('matrix.room.message', {
    roomId: '!room-1:agent-hub.local',
    senderMxid: '@alice:agent-hub.local',
    body: '/agora dispatch build bridge',
  });
  await tick();
  assert.ok(harness.sent.length >= 1, 'dispatch placeholder posted');

  // 2) a reply in the same room ingests into agora
  await handler({
    roomId: '!room-1:agent-hub.local',
    eventId: '$evt-reply',
    sender: '@alice:agent-hub.local',
    type: 'm.room.message',
    body: '我来处理这个',
    relatesTo: { inReplyTo: { eventId: '$evt-orig' } },
    originServerTs: 1785556800000,
  });
  await tick();

  assert.ok(harness.replied.length >= 1, 'recordInboundReply called');
  const call = harness.replied[0];
  assert.equal(call.taskId, 'task_1');
  assert.equal(call.input.provider, 'matrix');
  assert.equal(call.input.provider_message_ref, '$evt-reply');
  assert.equal(call.input.parent_message_ref, '$evt-orig');
  assert.equal(call.input.body, '我来处理这个');
  assert.equal(call.input.author_ref, '@alice:agent-hub.local');
  assert.ok(call.input.thread_task_binding_key.startsWith('mx_'), 'opaque threadKey');
});

test('reply-wiring: non-message events, own messages, unbound rooms are ignored', async (t) => {
  const harness = makeWiringHarness();
  const ctx = makeContext();
  t.after(() => ctx.cleanup());
  buildPlugin(harness, ctx);
  const handler = harness.timelineHandler();

  await handler({ roomId: '!r:hs', eventId: '$e1', sender: '@x:hs', type: 'm.room.member' });
  await handler({ roomId: '!r:hs', eventId: '$e2', sender: '@bot:agent-hub.local', type: 'm.room.message', body: 'hi', isOwn: true });
  await handler({ roomId: '!unbound:hs', eventId: '$e3', sender: '@x:hs', type: 'm.room.message', body: 'hi' });
  await tick();
  assert.equal(harness.replied.length, 0);
});

test('reply-wiring: own sender (transport isOwn) never ingests even in bound room', async (t) => {
  const harness = makeWiringHarness();
  const ctx = makeContext();
  t.after(() => ctx.cleanup());
  buildPlugin(harness, ctx);

  // bind the room first
  ctx.emit('matrix.room.message', {
    roomId: '!room-1:agent-hub.local',
    senderMxid: '@alice:agent-hub.local',
    body: '/agora dispatch build bridge',
  });
  await tick();

  // bot's own reply (e.g. panel edit echo) must be skipped
  await harness.timelineHandler()({
    roomId: '!room-1:agent-hub.local',
    eventId: '$evt-self',
    sender: '@bot:agent-hub.local',
    type: 'm.room.message',
    body: 'status update',
    isOwn: true,
  });
  await tick();
  assert.equal(harness.replied.length, 0);
});
