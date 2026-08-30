/**
 * bridges unit tests.
 *
 * Mock agora-rest client + verify human-readable output the message router
 * will send back to the matrix room.
 *
 * v0.1.1: all endpoints are deployed, so the bridges render real data
 * (no more endpoint-not-deployed stubs).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ArtifactBridge,
  AttentionBridge,
  CitizenBridge,
  CompanyBridge,
  DispatchBridge,
  ExecutiveAssistantBridge,
  TaskBridge,
} from '../lib/bridges.js';

function makeAgora(overrides = {}) {
  return {
    health: async () => ({ status: 'ok' }),
    listTemplates: async () => overrides.templates ?? [
      { id: 'quick', name: 'Quick', type: 'quick', description: 'one-shot', governance: 'lean', stage_count: 1 },
    ],
    listTasks: async () => [],
    getTask: async (id) => overrides.task ?? { id, state: 'running', type: 'quick', creator: '@u:hs', current_stage: 'execute' },
    createTask: async (input) => overrides.taskReceipt ?? { id: 'task_42', state: 'pending', type: input.type, title: input.title, creator: input.creator },
    listProjects: async () => ({ projects: [] }),
    getProject: async () => ({}),
    searchBrain: async (_pid, query) => overrides.brainHits ?? [
      { reference_key: 'doc:design', kind: 'doc', slug: 'design', score: 0.93, excerpt: query },
    ],
    listArtifacts: async () => [],
    getArtifact: async () => ({}),
    getArtifactContent: async (id) => ({ artifact_id: id, bytes: new Uint8Array([1, 2, 3]), media_type: 'text/plain', name: 'a.txt' }),
    listCitizens: async (_projectId) => overrides.citizens ?? [
      { citizen_id: 'cit-a', project_id: 'node-a', role_id: 'controller', display_name: 'Alpha', persona: null, status: 'active', boundaries: [], skills_ref: [], channel_policies: {}, runtime_projection: { adapter: 'openclaw', auto_provision: false, metadata: {} } },
      { citizen_id: 'cit-b', project_id: 'node-a', role_id: 'craftsman', display_name: 'Beta', persona: null, status: 'active', boundaries: [], skills_ref: [], channel_policies: {}, runtime_projection: { adapter: 'openclaw', auto_provision: false, metadata: {} } },
    ],
    getCitizen: async (id) => overrides.citizen ?? {
      citizen_id: id, project_id: 'node-a', role_id: 'controller', display_name: 'Alpha', persona: 'helpful assistant', status: 'active',
      boundaries: ['no shell'], skills_ref: ['agora.citizen'],
      channel_policies: {}, runtime_projection: { adapter: 'openclaw', auto_provision: false, metadata: {} },
    },
    pollEvents: async () => ({ events: [], nextSince: 0 }),
    listOrganizations: async () => overrides.organizations ?? [],
    getOrganization: async () => overrides.organizationSnapshot ?? {
      organization: {
        id: 'org-1', slug: 'acme', name: 'Acme', ownerRef: 'owner',
        informationDomain: 'domain:company', purpose: 'Build a durable agent company', status: 'active',
      },
      units: [{ id: 'unit-1', name: 'Research', kind: 'department', parentUnitId: null }],
      positions: [
        { id: 'pos-ea', unitId: 'unit-1', title: 'Executive Assistant', kind: 'executive_assistant', reportsToPositionId: null },
        { id: 'pos-r', unitId: 'unit-1', title: 'Research Lead', kind: 'lead', reportsToPositionId: 'pos-ea' },
      ],
      employments: [
        { id: 'emp-ea', positionId: 'pos-ea', subjectRef: 'node-b/ea', employmentKind: 'resident', status: 'active' },
        { id: 'emp-old', positionId: 'pos-r', subjectRef: 'old/research', employmentKind: 'resident', status: 'ended' },
      ],
    },
    createExecutiveRequest: async (_org, input) => overrides.executiveResult ?? {
      ok: true,
      request: {
        id: 'req-1', status: 'delegated', taskId: 'task-1', title: input.title,
        assignedPositionId: 'pos-r', blockedReason: null,
      },
      commitment: { id: 'commit-1', status: 'open', taskId: 'task-1' },
    },
    listExecutiveInbox: async () => overrides.executiveInbox ?? [],
    listCommitments: async () => overrides.commitments ?? [],
    getExecutiveRequest: async () => overrides.executiveRequest ?? { id: 'req-1', title: 'Research', status: 'delegated', taskId: 'task-1' },
    reconcileExecutiveRequest: async () => overrides.executiveResult ?? {
      ok: true,
      request: { id: 'req-1', title: 'Research', status: 'completed', taskId: 'task-1' },
      commitment: { id: 'commit-1', status: 'fulfilled', taskId: 'task-1', evidenceRefs: ['artifact:1'] },
    },
    ...overrides.agora,
  };
}

test('CitizenBridge.list: renders header + bullet per citizen', async () => {
  const bridge = new CitizenBridge(makeAgora());
  const out = await bridge.list('node-a');
  assert.match(out, /Citizens \(2\)/);
  assert.match(out, /Alpha/);
  assert.match(out, /Beta/);
  assert.match(out, /cit-a/);
});

test('CitizenBridge.list: empty project returns empty notice', async () => {
  const bridge = new CitizenBridge(makeAgora({ citizens: [] }));
  const out = await bridge.list('node-a');
  assert.match(out, /No citizens visible/);
});

test('CitizenBridge.show: renders persona + boundaries + skills', async () => {
  const bridge = new CitizenBridge(makeAgora());
  const out = await bridge.show('cit-a');
  assert.match(out, /helpful assistant/);
  assert.match(out, /no shell/);
  assert.match(out, /agora.citizen/);
});

test('DispatchBridge.dispatch: posts v0.6.0 schema (no threadKey/actor/target on the wire)', async () => {
  const captured = { input: null };
  const agora = makeAgora({
    agora: {
      createTask: async (input) => {
        captured.input = input;
        return { id: 'task_42', state: 'pending', type: input.type, title: input.title, creator: input.creator };
      },
    },
  });
  const bridge = new DispatchBridge(agora, { projectId: 'node-a', defaultCreator: '@b:hs', defaultTemplate: 'quick' });
  // Use a Chinese prompt that cannot be misread as a citizen_id.
  const r = await bridge.dispatch(['帮我', 'REMOTE_OK']);
  assert.equal(r.receipt.task_id, 'task_42');
  assert.match(r.placeholder, /task_42/);
  assert.equal(captured.input.title, '帮我 REMOTE_OK');
  assert.equal(captured.input.type, 'quick');
  assert.equal(captured.input.creator, '@b:hs');
  assert.equal(captured.input.priority, 'normal');
  assert.equal(captured.input.threadKey, undefined);
  assert.equal(captured.input.actor, undefined);
  assert.equal(captured.input.target, undefined);
  // No @mention in args → no team_override.
  assert.equal(captured.input.team_override, undefined);
});

test('DispatchBridge.dispatch: @mention sets team_override with member_kind=citizen', async () => {
  const captured = { input: null };
  const agora = makeAgora({
    agora: {
      createTask: async (input) => {
        captured.input = input;
        return { id: 'task_99', state: 'pending', type: input.type, title: input.title, creator: input.creator };
      },
    },
  });
  const bridge = new DispatchBridge(agora, { projectId: 'node-a', defaultCreator: '@b:hs', defaultTemplate: 'quick' });
  const r = await bridge.dispatch(['@code-reviewer', '帮我审', 'PR']);
  assert.equal(r.receipt.task_id, 'task_99');
  assert.match(r.placeholder, /@code-reviewer/);
  assert.ok(captured.input.team_override, 'team_override should be set when @mention is given');
  assert.equal(captured.input.team_override.members.length, 1);
  assert.equal(captured.input.team_override.members[0].agentId, 'code-reviewer');
  assert.equal(captured.input.team_override.members[0].member_kind, 'citizen');
  assert.equal(captured.input.team_override.members[0].role, 'executor');
});

test('DispatchBridge.dispatch: empty args throws', async () => {
  const bridge = new DispatchBridge(makeAgora(), { projectId: 'node-a', defaultCreator: '@b:hs' });
  await assert.rejects(bridge.dispatch([]));
});

test('TaskBridge.show: shows id + state + creator + type', async () => {
  const bridge = new TaskBridge(makeAgora());
  const out = await bridge.show('task_42');
  assert.match(out, /task_42/);
  assert.match(out, /status=running/);
  assert.match(out, /stage=execute/);
  assert.match(out, /creator: @u:hs/);
  assert.match(out, /type: quick/);
});

test('ArtifactBridge.fetchBytes: returns bytes + media + name', async () => {
  const bridge = new ArtifactBridge(makeAgora());
  const r = await bridge.fetchBytes('sha256-x');
  assert.equal(r.mediaType, 'text/plain');
  assert.equal(r.name, 'a.txt');
  assert.equal(r.bytes.length, 3);
});

test('AttentionBridge.search: empty query returns usage error string', async () => {
  const bridge = new AttentionBridge(makeAgora());
  const out = await bridge.search('node-a', '   ');
  assert.match(out, /non-empty query/);
});

test('AttentionBridge.search: formats top-N hits with score + excerpt', async () => {
  const bridge = new AttentionBridge(makeAgora({
    brainHits: [
      { reference_key: 'a', kind: 'doc', slug: 'a', score: 0.91, excerpt: 'first' },
      { reference_key: 'b', kind: 'doc', slug: 'b', score: 0.80, excerpt: 'second' },
    ],
  }));
  const out = await bridge.search('node-a', 'foo');
  assert.match(out, /brain search top 2/);
  assert.match(out, /0\.91/);
  assert.match(out, /first/);
});

test('AttentionBridge.search: empty hits returns friendly message', async () => {
  const bridge = new AttentionBridge(makeAgora({ brainHits: [] }));
  const out = await bridge.search('node-a', 'foo');
  assert.match(out, /no matches/);
});

test('CompanyBridge.show: renders hierarchy and only current staff as occupied', async () => {
  const bridge = new CompanyBridge(makeAgora(), { defaultOrganization: 'acme' });
  const out = await bridge.show();
  assert.match(out, /Acme/);
  assert.match(out, /domain:company/);
  assert.match(out, /Executive Assistant/);
  assert.match(out, /node-b\/ea/);
  assert.match(out, /Research Lead.*vacant/);
});

test('ExecutiveAssistantBridge.ask: resolves slug and forwards capability to Core', async () => {
  const captured = { organizationId: null, input: null };
  const agora = makeAgora({
    agora: {
      createExecutiveRequest: async (organizationId, input) => {
        captured.organizationId = organizationId;
        captured.input = input;
        return {
          ok: true,
          request: { id: 'req-9', status: 'delegated', taskId: 'task-9', assignedPositionId: 'pos-r', blockedReason: null },
          commitment: { id: 'commit-9', status: 'open', taskId: 'task-9' },
        };
      },
    },
  });
  const bridge = new ExecutiveAssistantBridge(agora, { defaultOrganization: 'acme', defaultProjectId: 'node-b' });
  const out = await bridge.ask(['--capability', 'research', '--type', 'research', '调研', '电池'], '@owner:hs');
  assert.equal(captured.organizationId, 'org-1');
  assert.deepEqual(captured.input.requested_capabilities, ['research']);
  assert.equal(captured.input.task_type, 'research');
  assert.equal(captured.input.project_id, 'node-b');
  assert.equal(captured.input.body, '调研 电池');
  assert.match(out, /req-9/);
  assert.match(out, /task-9/);
});

test('ExecutiveAssistantBridge.ask: renders durable blocked intake honestly', async () => {
  const bridge = new ExecutiveAssistantBridge(makeAgora({
    executiveResult: {
      ok: true,
      request: { id: 'req-b', status: 'blocked', taskId: null, assignedPositionId: null, blockedReason: 'no active executive assistant employment' },
      commitment: null,
    },
  }), { defaultOrganization: 'acme', defaultProjectId: 'node-b' });
  const out = await bridge.ask(['请处理'], '@owner:hs');
  assert.match(out, /blocked/);
  assert.match(out, /no active executive assistant/);
  assert.match(out, /req-b/);
});

test('ExecutiveAssistantBridge.inbox: renders request status and task', async () => {
  const bridge = new ExecutiveAssistantBridge(makeAgora({
    executiveInbox: [{ id: 'req-1', title: 'Research', status: 'delegated', priority: 'high', taskId: 'task-1' }],
  }), { defaultOrganization: 'acme', defaultProjectId: 'node-b' });
  const out = await bridge.inbox([]);
  assert.match(out, /Assistant inbox \(1\)/);
  assert.match(out, /Research/);
  assert.match(out, /task-1/);
});
