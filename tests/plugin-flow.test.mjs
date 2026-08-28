/**
 * plugin-flow integration test.
 *
 * Exercises the full Cordis plugin apply() with a fake matrix transport
 * and a fake agora REST. Verifies that an Element "/agora dispatch ..." user
 * message is parsed, dispatched to agora, and a placeholder message is sent.
 *
 * v0.1 reality (2026-08-28 probe): events polling is disabled because
 * GET /api/events is not deployed. This file therefore omits the
 * event-driven placeholder-edit assertion and adds an explicit test that
 * the plugin never auto-edits placeholders until v0.2.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMatrixConnectorPlugin } from '../lib/index.js';
import { MatrixClient } from '../lib/matrix-client.js';
import { EndpointNotDeployedError } from '../lib/agora-rest.js';

function makeContext() {
  const listeners = new Map();
  const effects = [];
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
    context: {
      on(event, handler) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(handler);
      },
      effect(fn) {
        const dispose = () => {};
        effects.push(() => fn(dispose));
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
  return { client: new MatrixClient(transport), sent, edits, uploads, get started() { return started; }, get stopped() { return stopped; } };
}

function makeAgoraStub() {
  const tasks = new Map();
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
    listCitizens: async () => { throw new EndpointNotDeployedError('GET /api/citizens'); },
    getCitizen: async () => { throw new EndpointNotDeployedError('GET /api/citizens/:id'); },
    pollEvents: async () => { throw new EndpointNotDeployedError('GET /api/events'); },
  };
}

function emit(ctx, event, payload) {
  const handlers = ctx.listeners.get(event);
  if (!handlers) return;
  for (const h of handlers) h(payload);
}

test('plugin: apply wires matrix; /agora dispatch creates a quick task and posts a placeholder', async () => {
  const ctx = makeContext();
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

  // user sends /agora dispatch ask REMOTE_OK
  emit(ctx, 'matrix.room.message', { roomId: '!room:hs', senderMxid: '@u:hs', body: '/agora dispatch ask REMOTE_OK' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(matrix.sent.length, 1);
  assert.match(matrix.sent[0].body, /task_id=task_1/);
  // no edits yet — v0.1 does not auto-edit placeholders
  assert.equal(matrix.edits.length, 0);
});

test('plugin: /agora citizen list surfaces the endpoint-not-deployed gap', async () => {
  const ctx = makeContext();
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
  assert.match(matrix.sent[0].body, /not available yet/);
});

test('plugin: /agora help sends honest help text', async () => {
  const ctx = makeContext();
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
  assert.match(matrix.sent[0].body, /endpoint not deployed/);
});

test('plugin: unknown command returns error message', async () => {
  const ctx = makeContext();
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

test('plugin: /agora brain search <q> surfaces top hit via context/retrieve', async () => {
  const ctx = makeContext();
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