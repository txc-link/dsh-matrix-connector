/**
 * tests/status-panel.test.mjs — RED tests for v0.3.3 status panel.
 *
 * Each Matrix room where the plugin has dispatched at least one task
 * gets a single "war room" status panel message. As SSE ticks update
 * the task states, the panel is edited (not re-posted). When a room
 * has zero in-flight tasks, no panel is shown.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildStatusPanel } from '../lib/status-panel.js';

function makeMatrix() {
  const sent = [];
  const edits = [];
  return {
    sent,
    edits,
    async sendText(roomId, body) {
      sent.push({ roomId, body });
      return { eventId: `evt_${sent.length}` };
    },
    async edit(roomId, eventId, body) {
      edits.push({ roomId, eventId, body });
      return { eventId, roomId, replaced: true };
    },
    async stopSync() {},
    async startSync() {},
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

describe('buildStatusPanel', () => {
  it('creates a panel on first tick for a new room', async () => {
    const matrix = makeMatrix();
    const taskBridge = makeTaskBridge({
'OC-1': { id: 'OC-1', state: 'active', team: { members: [{ role: 'executor', agentId: 'haiku' }] }, current_stage: 'execute' },
    });
    const roomTasks = new Map([['!room:hs', new Set(['OC-1'])]]);
    const panel = buildStatusPanel({ matrix, taskBridge, roomTasks, roomId: '!room:hs' });

    await panel.handleTick('OC-1');

    assert.equal(matrix.sent.length, 1);
    assert.match(matrix.sent[0].body, /war room/);
    assert.match(matrix.sent[0].body, /OC-1/);
    assert.equal(matrix.edits.length, 0);
  });

  it('edits the existing panel on subsequent ticks', async () => {
    const matrix = makeMatrix();
    const taskBridge = makeTaskBridge({
'OC-1': { id: 'OC-1', state: 'active', team: { members: [{ role: 'executor', agentId: 'haiku' }] }, current_stage: 'execute' },
'OC-2': { id: 'OC-2', state: 'active', team: { members: [{ role: 'executor', agentId: 'coder' }] }, current_stage: 'execute' },
    });
    const roomTasks = new Map([['!room:hs', new Set(['OC-1', 'OC-2'])]]);
    const panel = buildStatusPanel({ matrix, taskBridge, roomTasks, roomId: '!room:hs' });

    await panel.handleTick('OC-1');
    assert.equal(matrix.sent.length, 1);
    const firstEventId = matrix.sent[0].eventId;
    await panel.handleTick('OC-2');

    assert.equal(matrix.sent.length, 1, 'second tick must edit, not repost');
    assert.equal(matrix.edits.length, 1);
    assert.equal(matrix.edits[0].eventId, 'evt_1');
    assert.match(matrix.edits[0].body, /OC-1/);
    assert.match(matrix.edits[0].body, /OC-2/);
  });

  it('renders per-task status line with executor + state', async () => {
    const matrix = makeMatrix();
    const taskBridge = makeTaskBridge({
'OC-1': { id: 'OC-1', state: 'active', team: { members: [{ role: 'executor', agentId: 'reviewer' }] }, current_stage: 'execute' },
    });
    const roomTasks = new Map([['!room:hs', new Set(['OC-1'])]]);
    const panel = buildStatusPanel({ matrix, taskBridge, roomTasks, roomId: '!room:hs' });

    await panel.handleTick('OC-1');

    assert.match(matrix.sent[0].body, /reviewer/);
    assert.match(matrix.sent[0].body, /execute/);
  });
});