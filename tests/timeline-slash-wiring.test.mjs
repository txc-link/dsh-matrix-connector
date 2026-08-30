/**
 * timeline-slash-wiring.test.mjs — v0.1.4 regression: the factory's
 * timeline handler must fan out non-reply m.room.message events into
 * handleRoomMessage (the /agora slash router). Previously
 * handleRoomMessage was only reachable via a 'matrix.room.message'
 * context event that nobody emitted, so slash commands were dead code.
 *
 * Reply-shaped events (m.relates_to.m.in_reply_to) must keep going to
 * ingestMatrixReply, NOT the slash router.
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

function makeHarness() {
  let timelineHandler = null;
  const replied = [];
  const sent = [];
  const executiveRequests = [];
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
    listOrganizations: async () => [{ id: 'org-1', slug: 'acme', name: 'Acme', status: 'active', informationDomain: 'domain:company' }],
    getOrganization: async () => ({
      organization: { id: 'org-1', slug: 'acme', name: 'Acme', status: 'active', informationDomain: 'domain:company', purpose: 'Agent company' },
      units: [], positions: [], employments: [],
    }),
    createExecutiveRequest: async (organizationId, input) => {
      executiveRequests.push({ organizationId, input });
      return {
        ok: true,
        request: { id: 'req-1', status: 'triage', taskId: 'task-1', assignedPositionId: 'pos-ea', blockedReason: null },
        commitment: { id: 'commit-1', status: 'open', taskId: 'task-1' },
      };
    },
    listExecutiveInbox: async () => [],
    listCommitments: async () => [],
    getExecutiveRequest: async () => ({ id: 'req-1', status: 'triage', title: 'x', priority: 'normal', requestedCapabilities: [], taskId: 'task-1', blockedReason: null }),
    reconcileExecutiveRequest: async () => ({
      ok: true,
      request: { id: 'req-1', status: 'triage', taskId: 'task-1', assignedPositionId: 'pos-ea', blockedReason: null },
      commitment: { id: 'commit-1', status: 'open', taskId: 'task-1' },
    }),
  };
  return {
    timelineHandler: () => timelineHandler,
    replied,
    sent,
    executiveRequests,
    agora,
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
      companyOrganization: 'acme',
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

const ROOM = '!room:agent-hub.local';

test('timeline: plain /agora help message reaches the slash router and gets a reply', async () => {
  const harness = makeHarness();
  const ctx = buildPlugin(harness, makeContext());
  const handler = harness.timelineHandler();

  handler({
    roomId: ROOM,
    eventId: 'evt_in_1',
    sender: '@alice:agent-hub.local',
    type: 'm.room.message',
    body: '/agora help',
  });
  await tick();

  assert.ok(harness.sent.length >= 1, 'bot must reply to /agora help via the slash router');
  assert.equal(harness.sent[0].roomId, ROOM);
  ctx.cleanup();
});

test('timeline: unknown non-reply message is routed (renderError reply), not dropped', async () => {
  const harness = makeHarness();
  const ctx = buildPlugin(harness, makeContext());
  const handler = harness.timelineHandler();

  handler({
    roomId: ROOM,
    eventId: 'evt_in_2',
    sender: '@alice:agent-hub.local',
    type: 'm.room.message',
    body: 'hello world',
  });
  await tick();

  assert.ok(harness.sent.length >= 1, 'non-reply messages must hit the slash router path');
  ctx.cleanup();
});

test('timeline: /agora company renders the Core organization snapshot', async () => {
  const harness = makeHarness();
  const ctx = buildPlugin(harness, makeContext());
  harness.timelineHandler()({
    roomId: ROOM,
    eventId: 'evt_company',
    sender: '@alice:agent-hub.local',
    type: 'm.room.message',
    body: '/agora company',
  });
  await tick();
  assert.match(harness.sent[0].body, /Acme/);
  assert.match(harness.sent[0].body, /domain:company/);
  ctx.cleanup();
});

test('timeline: /agora assistant ask creates a durable Core request', async () => {
  const harness = makeHarness();
  const ctx = buildPlugin(harness, makeContext());
  harness.timelineHandler()({
    roomId: ROOM,
    eventId: 'evt_assistant',
    sender: '@alice:agent-hub.local',
    type: 'm.room.message',
    body: '/agora assistant ask --capability research 调研电池',
  });
  await tick();
  assert.equal(harness.executiveRequests.length, 1);
  assert.equal(harness.executiveRequests[0].organizationId, 'org-1');
  assert.deepEqual(harness.executiveRequests[0].input.requested_capabilities, ['research']);
  assert.match(harness.sent[0].body, /req-1/);
  ctx.cleanup();
});

test('timeline: reply-shaped message goes to ingestMatrixReply, NOT the slash router', async () => {
  const harness = makeHarness();
  const ctx = buildPlugin(harness, makeContext());
  const handler = harness.timelineHandler();

  handler({
    roomId: ROOM,
    eventId: 'evt_in_3',
    sender: '@alice:agent-hub.local',
    type: 'm.room.message',
    body: 'reply text',
    relatesTo: { inReplyTo: { eventId: 'evt_out_9' } },
  });
  await tick();

  assert.equal(harness.sent.length, 0, 'reply-shaped events must not trigger slash replies');
  assert.equal(harness.replied.length, 0, 'unbound rooms have no task to record against');
  ctx.cleanup();
});

test('timeline: own messages and non-message events are ignored', async () => {
  const harness = makeHarness();
  const ctx = buildPlugin(harness, makeContext());
  const handler = harness.timelineHandler();

  handler({
    roomId: ROOM,
    eventId: 'evt_own',
    sender: '@bot:agent-hub.local',
    type: 'm.room.message',
    body: '/agora help',
    isOwn: true,
  });
  handler({
    roomId: ROOM,
    eventId: 'evt_member',
    sender: '@alice:agent-hub.local',
    type: 'm.room.member',
  });
  await tick();

  assert.equal(harness.sent.length, 0, 'own messages must be filtered');
  ctx.cleanup();
});
