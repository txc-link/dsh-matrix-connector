import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderRuntimeRoster, renderRuntimeTeam, RuntimeRosterBridge } from '../lib/runtime-roster.js';

const nodes = [{
  node_id: 'node-home-linux',
  presence: 'online',
  host_framework: 'deepseek-harness',
  runtime_provider: 'dsh',
  agents: [{
    agent_ref: 'default',
    display_name: 'Home Linux Agent',
    model: 'deepseek-chat',
    roles: ['general', 'reviewer'],
    capabilities: ['research'],
    metadata: { identity_ref: 'gpu-home-pi', harness_label: 'Pi' },
  }],
  bots: [],
  metadata: {
    machine: {
      label: 'Home GPU',
      access: { protocol: 'ssh', host: '198.51.100.10', port: 16000, user: 'root', reachability: 'public-tunnel' },
    },
  },
  last_seen_at: '2026-09-17T05:00:00Z',
}];

const targets = [{
  runtime_target_ref: 'dsh:node-home-linux:default',
  runtime_provider: 'dsh',
  runtime_flavor: 'native',
  host_framework: 'deepseek-harness',
  primary_model: 'deepseek-chat',
  channel_providers: ['matrix'],
  enabled: true,
  display_name: 'Home Linux Agent',
  presentation_mode: 'headless',
}];

test('runtime roster renders machine, harness, presence and roles', () => {
  const output = renderRuntimeRoster(nodes, targets);
  assert.match(output, /node-home-linux/);
  assert.match(output, /harness=Pi/);
  assert.match(output, /presence=online/);
  assert.match(output, /roles=general,reviewer/);
  assert.match(output, /dsh:node-home-linux:default/);
  assert.match(output, /identity=gpu-home-pi/);
  assert.match(output, /machine=node-home-linux \(Home GPU\)/);
  assert.match(output, /harness=Pi/);
  assert.match(output, /access=ssh:\/\/root@198\.51\.100\.10:16000/);
});

test('runtime team maps a task role onto the runtime inventory', () => {
  const output = renderRuntimeTeam([{ role: 'executor', agentId: 'default' }], nodes, targets).join('\n');
  assert.match(output, /executor/);
  assert.match(output, /machine=node-home-linux/);
  assert.match(output, /harness=Pi/);
});

test('runtime team keeps unresolved assignments explicit', () => {
  const output = renderRuntimeTeam([{ role: 'reviewer', agentId: 'missing' }], nodes, targets).join('\n');
  assert.match(output, /machine=unresolved/);
  assert.match(output, /harness=unresolved/);
});

test('runtime roster bridge degrades clearly when both inventory endpoints fail', async () => {
  const bridge = new RuntimeRosterBridge({
    listRuntimeNodes: async () => { throw new Error('nodes endpoint unavailable'); },
    listRuntimeTargets: async () => { throw new Error('targets endpoint unavailable'); },
  });
  const output = await bridge.show();
  assert.match(output, /Agent roster unavailable/);
});
