/**
 * tests/stuck-alert.test.mjs — RED tests for v2.0.1 stuck alert.
 *
 * The agora central background scheduler emits an `inbox_escalated`
 * flow_log row when a task has been idle past the escalation policy.
 * The plugin's SSE stream receives that as an event:tick with
 * type='inbox_escalated'. The stuck-alert module posts a one-shot
 * summary to the originating room and dedupes by task_id.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildStuckAlert } from '../lib/stuck-alert.js';

function makeMatrix() {
  const sent = [];
  return {
    sent,
    async sendText(roomId, body) {
      sent.push({ roomId, body });
      return { eventId: `evt_${sent.length}` };
    },
  };
}

function makeTaskBridge(stub) {
  return {
    async show(taskId) {
      if (stub[taskId]) return stub[taskId];
      throw new Error(`unknown task ${taskId}`);
    },
  };
}

describe('buildStuckAlert', () => {
  it('posts a stuck alert when an inbox_escalated event fires', async () => {
    const matrix = makeMatrix();
    const taskBridge = makeTaskBridge({
      'OC-1': {
        id: 'OC-1',
        state: 'active',
        current_stage: 'execute',
        creator: '@user:hs',
        team: { members: [{ role: 'executor', agentId: 'haiku' }] },
        subtasks: [],
      },
    });
    const rooms = new Map([['OC-1', '!room:hs']]);
    const alerted = new Set();
    const stuck = buildStuckAlert({ matrix, taskBridge, roomForTask: (id) => rooms.get(id), alerted });

    await stuck.handleEvent({
      task_id: 'OC-1',
      type: 'inbox_escalated',
      detail: { kind: 'inbox_escalated', idle_ms: 47000 },
    });

    assert.equal(matrix.sent.length, 1);
    assert.match(matrix.sent[0].body, /\[agora stuck\]/);
    assert.match(matrix.sent[0].body, /OC-1/);
    assert.match(matrix.sent[0].body, /47s/);
    assert.match(matrix.sent[0].body, /execute/);
    assert.match(matrix.sent[0].body, /haiku/);
    assert.ok(alerted.has('OC-1'));
  });

  it('does not post when the event is not inbox_escalated', async () => {
    const matrix = makeMatrix();
    const taskBridge = makeTaskBridge({});
    const rooms = new Map();
    const alerted = new Set();
    const stuck = buildStuckAlert({ matrix, taskBridge, roomForTask: (id) => rooms.get(id), alerted });

    await stuck.handleEvent({
      task_id: 'OC-2',
      type: 'state_changed',
      detail: null,
    });

    assert.equal(matrix.sent.length, 0);
  });

  it('does not post twice for the same task', async () => {
    const matrix = makeMatrix();
    const taskBridge = makeTaskBridge({
      'OC-3': {
        id: 'OC-3',
        state: 'active',
        current_stage: 'execute',
        creator: '@u',
        team: { members: [{ role: 'executor', agentId: 'haiku' }] },
      },
    });
    const rooms = new Map([['OC-3', '!room:hs']]);
    const alerted = new Set();
    const stuck = buildStuckAlert({ matrix, taskBridge, roomForTask: (id) => rooms.get(id), alerted });

    await stuck.handleEvent({ task_id: 'OC-3', type: 'inbox_escalated', detail: { kind: 'inbox_escalated', idle_ms: 10000 } });
    await stuck.handleEvent({ task_id: 'OC-3', type: 'inbox_escalated', detail: { kind: 'inbox_escalated', idle_ms: 20000 } });

    assert.equal(matrix.sent.length, 1);
  });

  it('skips when the task has no room binding', async () => {
    const matrix = makeMatrix();
    const taskBridge = makeTaskBridge({
      'OC-4': { id: 'OC-4', state: 'active', current_stage: 'execute', creator: '@u', team: { members: [] } },
    });
    const rooms = new Map();
    const alerted = new Set();
    const stuck = buildStuckAlert({ matrix, taskBridge, roomForTask: (id) => rooms.get(id), alerted });

    await stuck.handleEvent({ task_id: 'OC-4', type: 'inbox_escalated', detail: { kind: 'inbox_escalated', idle_ms: 10000 } });

    assert.equal(matrix.sent.length, 0);
    assert.ok(!alerted.has('OC-4'));
  });
});