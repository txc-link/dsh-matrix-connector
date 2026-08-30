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
    authorizeInformationProjection: async () => ({ allowed: true, reason: 'same-domain', grant_id: null }),
    assessActionRisk: async () => ({ id: 'risk-1', decision: 'allow', risk_level: 'low', reasons: [] }),
    claimRelationshipInitiatives: async () => [],
    markRelationshipInitiativeDelivered: async () => undefined,
    markRelationshipInitiativeFailed: async () => undefined,
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
    streamEvents: async (_since, signal) => {
      // SSE mock: return a 200 with a never-yielding body so the SSE loop
      // in src/index.ts parks here without throwing on real-world plumbing.
      return new Response(new ReadableStream({
        start(controller) {
          if (signal) {
            signal.addEventListener('abort', () => controller.close());
          }
        },
      }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
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
  assert.equal(matrix.stopped, false);

  emit(ctx, 'matrix.room.message', { roomId: '!room:hs', senderMxid: '@u:hs', body: '/agora dispatch ask REMOTE_OK' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(matrix.sent.length, 1);
  assert.match(matrix.sent[0].body, /task_id=task_1/);

  ctx.cleanup();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(matrix.stopped, true);
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

test('plugin: organization intake does not reuse nodeId as projectId', async (t) => {
  const ctx = makeContext();
  t.after(() => ctx.cleanup());
  const matrix = makeMatrixStub();
  const agora = makeAgoraStub();
  let capturedInput;
  agora.getOrganization = async () => ({ organization: { id: 'org-1' } });
  agora.createExecutiveRequest = async (_organizationId, input) => {
    capturedInput = input;
    return {
      ok: true,
      request: { id: 'req-1', status: 'delegated', taskId: 'task-1', assignedPositionId: 'position-1', blockedReason: null },
      commitment: { id: 'commitment-1', status: 'open', taskId: 'task-1' },
    };
  };
  const plugin = createMatrixConnectorPlugin({
    config: {
      homeserverUrl: 'http://hs', userId: '@b:hs', accessToken: 'tok', deviceId: 'd',
      agoraServerUrl: 'http://agora', agoraApiToken: 'atok', nodeId: 'node-home-linux',
      companyOrganization: 'agent-company',
    },
    matrixClient: matrix.client, agora, context: ctx.context,
  });
  await plugin.apply(ctx.context);
  emit(ctx, 'matrix.room.message', {
    roomId: '!room:hs', senderMxid: '@root:hs',
    body: '/agora assistant ask --capability research test request',
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(capturedInput.project_id, null);
  assert.match(matrix.sent[0].body, /req-1/);
});

test('plugin: command failures are returned to the Matrix room', async (t) => {
  const ctx = makeContext();
  t.after(() => ctx.cleanup());
  const matrix = makeMatrixStub();
  const agora = makeAgoraStub();
  agora.health = async () => { throw new Error('Core unavailable'); };
  const plugin = createMatrixConnectorPlugin({
    config: {
      homeserverUrl: 'http://hs', userId: '@b:hs', accessToken: 'tok', deviceId: 'd',
      agoraServerUrl: 'http://agora', agoraApiToken: 'atok', nodeId: 'node-a',
    },
    matrixClient: matrix.client, agora, context: ctx.context,
  });
  await plugin.apply(ctx.context);
  emit(ctx, 'matrix.room.message', { roomId: '!room:hs', senderMxid: '@root:hs', body: '/agora im health' });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(matrix.sent[0].body, /command failed: Core unavailable/);
  assert.ok(ctx.logs.some((entry) => entry.some((value) => String(value).includes('command failed'))));
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

test('plugin: governed companion event sends audio only inside the bound personal domain', async (t) => {
  const ctx = makeContext();
  t.after(() => ctx.cleanup());
  const matrix = makeMatrixStub();
  const agora = makeAgoraStub();
  const plugin = createMatrixConnectorPlugin({
    config: {
      homeserverUrl: 'http://hs', userId: '@companion:hs', accessToken: 'tok', deviceId: 'd',
      agoraServerUrl: 'http://agora', agoraApiToken: 'atok', nodeId: 'node-a',
      securityBoundary: {
        domainRef: 'domain:companion', boundaryKind: 'companion', rootSpaceId: '!companion:hs',
        allowedRoomIds: ['!private:hs'], requireTopLevelRoot: true,
      },
      speech: { enabled: true, provider: 'windows-sapi' },
    },
    matrixClient: matrix.client,
    agora,
    context: ctx.context,
    speechSynthesizer: {
      synthesize: async () => ({
        bytes: new Uint8Array([1, 2, 3]), contentType: 'audio/wav', filename: 'care.wav', durationMs: 900,
      }),
    },
  });
  await plugin.apply(ctx.context);
  emit(ctx, 'agora.companion.voice', {
    roomId: '!private:hs', text: '晚安。', resourceRef: 'memory:companion/1',
    sourceDomain: 'domain:companion', actorRef: 'relationship:companion-1',
    subjectRef: 'person:owner', purpose: 'proactive-care',
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(matrix.uploads.length, 1);
  assert.equal(matrix.sent[0].msgType, 'm.audio');

  emit(ctx, 'agora.companion.voice', {
    roomId: '!private:hs', text: 'should not leave work', resourceRef: 'memory:work/1',
    sourceDomain: 'domain:company', actorRef: 'relationship:companion-1',
    subjectRef: 'person:owner', purpose: 'proactive-care',
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(matrix.uploads.length, 1);
});

test('plugin: bound personal connector ignores commands from rooms outside its boundary', async (t) => {
  const ctx = makeContext();
  t.after(() => ctx.cleanup());
  const matrix = makeMatrixStub();
  const plugin = createMatrixConnectorPlugin({
    config: {
      homeserverUrl: 'http://hs', userId: '@life:hs', accessToken: 'tok', deviceId: 'd',
      agoraServerUrl: 'http://agora', agoraApiToken: 'atok',
      securityBoundary: {
        domainRef: 'domain:life', boundaryKind: 'personal-office', rootSpaceId: '!life:hs',
        allowedRoomIds: ['!schedule:hs'], requireTopLevelRoot: true,
      },
    },
    matrixClient: matrix.client, agora: makeAgoraStub(), context: ctx.context,
  });
  await plugin.apply(ctx.context);
  emit(ctx, 'matrix.room.message', { roomId: '!company:hs', senderMxid: '@u:hs', body: '/agora help' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(matrix.sent.length, 0);
});

test('plugin: startup poll claims a durable Core initiative and acknowledges voice delivery', async (t) => {
  const ctx = makeContext();
  t.after(() => ctx.cleanup());
  const matrix = makeMatrixStub();
  const agora = makeAgoraStub();
  const acknowledgements = [];
  let claimed = false;
  agora.claimRelationshipInitiatives = async () => {
    if (claimed) return [];
    claimed = true;
    return [{
      id: 'initiative-1', profile_id: 'rel-luna', profile_version: 1,
      owner_ref: 'human:ceo', agent_ref: 'agent:luna', trigger: 'scheduled_check_in', modality: 'voice',
      text: '今天也辛苦了。', resource_ref: 'memory:companion/check-in-1',
      source_domain: 'domain:companion', target_domain: 'domain:companion',
      delivery_binding_ref: 'binding:companion-primary', purpose: 'proactive-care',
      requested_fields: ['text'], lease_token: 'lease-1',
    }];
  };
  agora.markRelationshipInitiativeDelivered = async (id, lease) => acknowledgements.push({ id, lease });
  const plugin = createMatrixConnectorPlugin({
    config: {
      homeserverUrl: 'http://hs', userId: '@companion:hs', accessToken: 'tok', deviceId: 'd',
      agoraServerUrl: 'http://agora', agoraApiToken: 'atok',
      securityBoundary: {
        domainRef: 'domain:companion', boundaryKind: 'companion', rootSpaceId: '!companion:hs',
        allowedRoomIds: ['!private:hs'],
      },
      speech: { enabled: true, provider: 'windows-sapi' },
      initiativeDelivery: {
        enabled: true, consumerRef: 'connector:companion-node-b', pollIntervalMs: 60_000,
        bindings: { 'binding:companion-primary': '!private:hs' },
      },
    },
    matrixClient: matrix.client, agora, context: ctx.context,
    speechSynthesizer: {
      synthesize: async () => ({
        bytes: new Uint8Array([1, 2, 3]), contentType: 'audio/wav', filename: 'care.wav', durationMs: 700,
      }),
    },
  });
  await plugin.apply(ctx.context);
  ctx.runEffects();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(matrix.sent[0].msgType, 'm.audio');
  assert.deepEqual(acknowledgements, [{ id: 'initiative-1', lease: 'lease-1' }]);
});
