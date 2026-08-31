/**
 * natural-chat wiring — plain Matrix timeline messages (no slash command,
 * no reply relation) are dispatched to the local DSH agent and the reply
 * is sent back to the room when `chat.enabled` is true.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMatrixConnectorPlugin } from '../lib/index.js';
import { MatrixClient } from '../lib/matrix-client.js';
import { buildThreadKey } from '../lib/thread-registry.js';

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

function makeHarness(chatDispatcher) {
  let timelineHandler = null;
  const sent = [];
  const transport = {
    sendRoomMessage: async (msg) => {
      sent.push(msg);
      return { eventId: `evt_out_${sent.length}`, roomId: msg.roomId };
    },
    editRoomMessage: async (roomId, eventId) => ({ eventId: `${eventId}_e`, roomId }),
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
  };
}

function buildPlugin(harness, ctx, chatDispatcher, configOverrides = {}) {
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
  });
  plugin.apply(ctx.context);
  ctx.runEffects();
  return ctx;
}

const tick = () => new Promise((r) => setTimeout(r, 30));

test('natural-chat: plain timeline message is dispatched and replied', async () => {
  const seen = [];
  const dispatcher = async (input) => {
    seen.push(input);
    return { answer: '我在呢', dispatchId: 'd-1' };
  };
  const harness = makeHarness(dispatcher);
  const ctx = buildPlugin(harness, makeContext(), dispatcher, {
    chat: { enabled: true, dshApiBaseUrl: 'http://127.0.0.1:3080', runtimeTargetRef: 'dsh:node-a:default' },
  });

  harness.timelineHandler()({
    roomId: '!chat:hs',
    eventId: '$plain-1',
    sender: '@root:hs',
    type: 'm.room.message',
    body: '你好',
  });
  await tick();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].prompt, '你好');
  assert.equal(seen[0].idempotencyKey, `matrix-${buildThreadKey('!chat:hs')}`);
  assert.equal(seen[0].threadKey, buildThreadKey('!chat:hs'));
  assert.equal(harness.sent.at(-1).body, '我在呢');
  ctx.cleanup();
});

test('natural-chat: persona from chat.personas is prepended per room', async () => {
  const seen = [];
  const dispatcher = async (input) => {
    seen.push(input);
    return { answer: '乖', dispatchId: 'd-2' };
  };
  const harness = makeHarness(dispatcher);
  const ctx = buildPlugin(harness, makeContext(), dispatcher, {
    chat: {
      enabled: true,
      runtimeTargetRef: 'dsh:node-a:default',
      personas: { '!gf:hs': '你是小栀，虚拟女友。' },
    },
  });

  harness.timelineHandler()({
    roomId: '!gf:hs',
    eventId: '$plain-2',
    sender: '@root:hs',
    type: 'm.room.message',
    body: '想你了',
  });
  await tick();

  assert.match(seen[0].prompt, /你是小栀/);
  assert.match(seen[0].prompt, /想你了/);
  ctx.cleanup();
});

test('natural-chat: slash commands still win over chat; chat disabled ignores plain text', async () => {
  const seen = [];
  const dispatcher = async (input) => {
    seen.push(input);
    return { answer: 'x', dispatchId: 'd-3' };
  };
  const harness = makeHarness(dispatcher);
  const ctx = buildPlugin(harness, makeContext(), dispatcher, {
    chat: { enabled: true, runtimeTargetRef: 'dsh:node-a:default' },
  });

  harness.timelineHandler()({
    roomId: '!chat:hs',
    eventId: '$cmd-1',
    sender: '@root:hs',
    type: 'm.room.message',
    body: '/agora help',
  });
  await tick();
  assert.equal(seen.length, 0, 'commands must not reach the chat dispatcher');
  assert.ok(harness.sent.length >= 1, 'command router replies instead');
  ctx.cleanup();

  const off = buildPlugin(harness, makeContext(), dispatcher, {
    chat: { enabled: false, runtimeTargetRef: 'dsh:node-a:default' },
  });
  const before = harness.sent.length;
  harness.timelineHandler()({
    roomId: '!chat:hs',
    eventId: '$plain-off',
    sender: '@root:hs',
    type: 'm.room.message',
    body: '你好',
  });
  await tick();
  assert.equal(harness.sent.length, before, 'chat disabled must ignore plain text');
  off.cleanup();
});

test('natural-chat: host matrix.room.message events also route plain text', async () => {
  const seen = [];
  const dispatcher = async (input) => {
    seen.push(input);
    return { answer: '收到', dispatchId: 'd-4' };
  };
  const harness = makeHarness(dispatcher);
  const ctx = buildPlugin(harness, makeContext(), dispatcher, {
    chat: { enabled: true, runtimeTargetRef: 'dsh:node-a:default' },
  });

  ctx.emit('matrix.room.message', {
    roomId: '!chat:hs',
    senderMxid: '@root:hs',
    body: '普通消息',
  });
  await tick();

  assert.equal(seen.length, 1);
  assert.equal(harness.sent.at(-1).body, '收到');
  ctx.cleanup();
});
