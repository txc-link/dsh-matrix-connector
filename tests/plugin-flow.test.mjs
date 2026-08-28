/**
 * plugin-flow integration test.
 *
 * Exercises the full Cordis plugin apply() with a fake matrix transport
 * and a fake agora REST. Verifies that an Element "/agora dispatch ..." user
 * message is parsed, dispatched to agora, placeholder edited, and events
 * flushed.
 *
 * v0.1.1: all endpoints are deployed on agora central. Events polling
 * is enabled, so the placeholder is auto-edited by the agora.events.tick
 * handler.
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
  let running = false;
  return {
    listeners,
    effects,
    logs,
    runEffects: () => {
      if (running) return;
      running = true;
      for (const f of effects) f();
    },
    cleanup: () => {
      while (disposes.length > 0) {
        const d = disposes.pop();
        try { d(); } catch { /* ignore */ }
      }
    },
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
  };
}

function makeMatrixStub() {
  const sent = [];
  const edits = [];
  const uploads = [];
  let started = false;
  let stopped = false;
  const transport = {
    sendRoomMessage: async (msg) => {
      sent.push(msg);
      return { eventId: `evt_${sent.length}`, roomId: msg.roomId };
    },
    editRoomMessage: async (roomId, eventId, replacement) => {
      edits.push({ roomId, eventId, replacement });
      return { eventId: `${eventId}_edited`, roomId, replaced: true };
    },
    uploadBytes: async (filename, contentType, bytes) => {
      uploads.push({ filename, contentType, size: bytes.length });
      return { mxcUri: `mxc://hs/${uploads.length}`, sizeBytes: bytes.length };
    },
    startSync: () => { started = true; },
    stopSync: async () => { stopped = true; },
  };
  return {
    client: new MatrixClient(transport),
    sent,
    edits,
    uploads,
    get started() { return started; },
    get stopped() { return stopped; },
  };
}

function makeAgoraStub() {
  const tasks = new Map();
  let pollEventsCalls = 0;
  return {
    health: async () => ({ status: 'ok' }),
    listTemplates: async () => [
      { id: 'quick', name: 'Quick', type: 'quick', description: 'one-shot', governance: 'lean', stage_count: 1 },
    ],
    listTasks: async () => [],
    getTask: async (id) => tasks.get(id) ?? null,
    createTask: async (input) => {
      const id = `task_${tasks.size + 1}`;
      tasks.set(id, { id, state: 'pending', ...input });
      return { id, state: 'pending', type: input.type, title: input.title, creator: input.creator };
    },
    listProjects: async () => ({ projects: [] }),
    getProject: async () => ({}),
    searchBrain: async (_pid, query) => [
      { reference_key: 'doc:design', kind: 'doc', slug: 'design', score: 0.9, excerpt: query },
    ],
    listArtifacts: async () => [],
    getArtifact: async () => ({}),
    getArtifactContent: async (id) => ({ artifact_id: id, bytes: new Uint8Array([1]), media_type: 'text/plain', name: 'a.txt' }),
    listCitizens: async (_projectId) => [
      {
        citizen_id: 'cit-a',
        project_id: 'node-a',
        role_id: 'controller',
        display_name: 'Alpha',
        persona: null,
        status: 'active',
        boundaries: [],
        skills_ref: [],
        channel_policies: {},
        runtime_projection: { adapter: 'openclaw', auto_provision: false, metadata: {} },
      },
    ],
    getCitizen: async (id) => ({
      citizen_id: id,
      project_id: 'node-a',
      role_id: 'controller',
      display_name: 'Alpha',
      persona: null,
      status: 'active',
      boundaries: [],
      skills_ref: [],
      channel_policies: {},
      runtime_projection: { adapter: 'openclaw', auto_provision: false, metadata: {} },
    }),
    pollEvents: async (since) => {
      pollEventsCalls += 1;
      return { events: [], nextSince: since };
    },
    get pollEventsCalls() { return pollEventsCalls; },
    markCompleted: (id) => { const t = tasks.get(id); if (t) t.status = 'completed'; },
    markRunning: (id) => { const t = tasks.get(id); if (t) t.status = 'running'; },
  };
}

function emit(ctx, event, payload) {
  const handlers = ctx.listeners.get(event);
  if (!handlers) return;
  for (const h of handlers) h(payload);
}

test('plugin: apply wires matrix; /agora dispatch creates a quick task and posts a placeholder', async (t) => {
  const ctx = makeContext();
  t.after(() => ctx.cleanup());
  const matrix = makeMatrixStub();
  const agora = makeAgoraStub();
  const plugin = createMatrixConnectorPlugin({
    config: {
      homeserverUrl: 'http://hs',
      userId: '@b:hs',
      accessToken: 'tok',
      deviceId: 'd',
      agoraServerUrl: 'http://agora',
      agoraApiToken: 'atok',
      nodeId: 'node-a',
      commandName: 'agora',
    },
    matrixClient: matrix.client,
    agora,
    context: ctx.context,
  });
  await plugin.apply(ctx.context);
  assert.equal(ctx.effects.length, 1);
  ctx.runEffects();
  assert.equal(matrix.started, true);

  emit(ctx, 'matrix.room.message', { roomId: '!room:hs', senderMxid: '@u:hs', body: '/agora dispatch ask REMOTE_OK' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(matrix.sent.length, 1);
  assert.match(matrix.sent[0].body, /task_id=task_1/);
});

test('plugin: agora.events.tick auto-edits the placeholder to running → completed', async (t) => {
  const ctx = makeContext();
  t.after(() => ctx.cleanup());
  const matrix = makeMatrixStub();
  const agora = makeAgoraStub();
  const plugin = createMatrixConnectorPlugin({
    config: {
      homeserverUrl: 'http://hs', userId: '@b:hs', accessToken: 'tok', deviceId: 'd',
      agoraServerUrl: 'http://agora', agoraApiToken: 'atok', nodeId: 'node-a',
    },
    matrixClient: matrix.client, agora, context: ctx.context,
  });
  await plugin.apply(ctx.context);

  emit(ctx, 'matrix.room.message', { roomId: '!room:hs', senderMxid: '@u:hs', body: '/agora dispatch ask REMOTE_OK' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(matrix.edits.length, 0);

  emit(ctx, 'agora.events.tick', {
    seq: 1,
    type: 'task_state_changed',
    task_id: 'task_1',
    state: 'running',
    detail: null,
    created_at: '2026-08-28T22:00:00Z',
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(matrix.edits.length, 1);
  assert.match(matrix.edits[0].replacement.body, /running/);

  emit(ctx, 'agora.events.tick', {
    seq: 2,
    type: 'task_state_changed',
    task_id: 'task_1',
    state: 'completed',
    detail: { result: 'REMOTE_OK' },
    created_at: '2026-08-28T22:00:01Z',
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(matrix.edits.length, 2);
  assert.match(matrix.edits[1].replacement.body, /completed/);
});

test('plugin: /agora citizen list renders citizens in room', async (t) => {
  const ctx = makeContext();
  t.after(() => ctx.cleanup());
  const matrix = makeMatrixStub();
  const agora = makeAgoraStub();
  const plugin = createMatrixConnectorPlugin({
    config: {
      homeserverUrl: 'http://hs', userId: '@b:hs', accessToken: 'tok', deviceId: 'd',
      agoraServerUrl: 'http://agora', agoraApiToken: 'atok', nodeId: 'node-a',
    },
    matrixClient: matrix.client, agora, context: ctx.context,
  });
  await plugin.apply(ctx.context);
  emit(ctx, 'matrix.room.message', { roomId: '!room:hs', senderMxid: '@u:hs', body: '/agora citizen list' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(matrix.sent[0].body, /Alpha/);
});

test('plugin: /agora help sends help text', async (t) => {
  const ctx = makeContext();
  t.after(() => ctx.cleanup());
  const matrix = makeMatrixStub();
  const agora = makeAgoraStub();
  const plugin = createMatrixConnectorPlugin({
    config: {
      homeserverUrl: 'http://hs', userId: '@b:hs', accessToken: 'tok', deviceId: 'd',
      agoraServerUrl: 'http://agora', agoraApiToken: 'atok', nodeId: 'node-a',
    },
    matrixClient: matrix.client, agora, context: ctx.context,
  });
  await plugin.apply(ctx.context);
  emit(ctx, 'matrix.room.message', { roomId: '!room:hs', senderMxid: '@u:hs', body: '/agora help' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(matrix.sent[0].body, /agora bridge/);
  assert.match(matrix.sent[0].body, /\/agora citizen/);
});

test('plugin: unknown command returns error message', async (t) => {
  const ctx = makeContext();
  t.after(() => ctx.cleanup());
  const matrix = makeMatrixStub();
  const agora = makeAgoraStub();
  const plugin = createMatrixConnectorPlugin({
    config: {
      homeserverUrl: 'http://hs', userId: '@b:hs', accessToken: 'tok', deviceId: 'd',
      agoraServerUrl: 'http://agora', agoraApiToken: 'atok', nodeId: 'node-a',
    },
    matrixClient: matrix.client, agora, context: ctx.context,
  });
  await plugin.apply(ctx.context);
  emit(ctx, 'matrix.room.message', { roomId: '!room:hs', senderMxid: '@u:hs', body: 'hello world' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(matrix.sent[0].body, /unknown command/);
});

test('plugin: /agora brain search <q> surfaces top hit via context/retrieve', async (t) => {
  const ctx = makeContext();
  t.after(() => ctx.cleanup());
  const matrix = makeMatrixStub();
  const agora = makeAgoraStub();
  const plugin = createMatrixConnectorPlugin({
    config: {
      homeserverUrl: 'http://hs', userId: '@b:hs', accessToken: 'tok', deviceId: 'd',
      agoraServerUrl: 'http://agora', agoraApiToken: 'atok', nodeId: 'node-a',
    },
    matrixClient: matrix.client, agora, context: ctx.context,
  });
  await plugin.apply(ctx.context);
  emit(ctx, 'matrix.room.message', { roomId: '!room:hs', senderMxid: '@u:hs', body: '/agora brain search dispatch' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(matrix.sent[0].body, /doc:design/);
});