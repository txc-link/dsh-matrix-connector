/**
 * tests/post-mortem.test.mjs — RED tests for the v0.3.1 war-room post-mortem.
 *
 * When the SSE tick for a task fires, the plugin should pull the task
 * record, look for completed subtasks or any output, and post a summary
 * message back to the room. Each task_id triggers the summary exactly
 * once (de-duplicated by an in-memory posted set).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPostMortem } from '../lib/post-mortem.js';

function makeMatrix(records) {
  const sent = [];
  return {
    sent,
    async sendText(roomId, body) {
      sent.push({ roomId, body });
      return { eventId: `evt_${sent.length}` };
    },
    async edit() {},
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

describe('buildPostMortem', () => {
  it('posts a summary when a subtask has output', async () => {
    const matrix = makeMatrix();
    const taskBridge = makeTaskBridge({
      'OC-1': {
        id: 'OC-1',
        state: 'active',
        team: { members: [{ role: 'executor', agentId: 'haiku' }] },
        subtasks: [{ status: 'completed', output: 'all good', done_at: '2026-08-29T00:00:00Z' }],
        artifacts: [],
      },
    });
    const rooms = new Map([['OC-1', '!room:hs']]);
    const posted = new Set();
    const pm = buildPostMortem({ matrix, taskBridge, roomForTask: (id) => rooms.get(id), posted });

    await pm.handleTick({ task_id: 'OC-1' });

    assert.equal(matrix.sent.length, 1);
    assert.match(matrix.sent[0].body, /post-mortem/);
    assert.match(matrix.sent[0].body, /OC-1/);
    assert.match(matrix.sent[0].body, /all good/);
    assert.ok(posted.has('OC-1'));
  });

  it('posts nothing when task has no subtasks with output', async () => {
    const matrix = makeMatrix();
    const taskBridge = makeTaskBridge({
      'OC-2': {
        id: 'OC-2',
        state: 'active',
        team: { members: [{ role: 'executor', agentId: 'haiku' }] },
        subtasks: [],
        artifacts: [],
      },
    });
    const rooms = new Map([['OC-2', '!room:hs']]);
    const posted = new Set();
    const pm = buildPostMortem({ matrix, taskBridge, roomForTask: (id) => rooms.get(id), posted });

    await pm.handleTick({ task_id: 'OC-2' });

    assert.equal(matrix.sent.length, 0);
    assert.ok(!posted.has('OC-2'));
  });

  it('does not double-post for repeated ticks of the same task', async () => {
    const matrix = makeMatrix();
    const taskBridge = makeTaskBridge({
      'OC-3': {
        id: 'OC-3',
        state: 'active',
        team: { members: [{ role: 'executor', agentId: 'haiku' }] },
        subtasks: [{ status: 'completed', output: 'ok', done_at: '2026-08-29T00:00:00Z' }],
        artifacts: [],
      },
    });
    const rooms = new Map([['OC-3', '!room:hs']]);
    const posted = new Set();
    const pm = buildPostMortem({ matrix, taskBridge, roomForTask: (id) => rooms.get(id), posted });

    await pm.handleTick({ task_id: 'OC-3' });
    await pm.handleTick({ task_id: 'OC-3' });
    await pm.handleTick({ task_id: 'OC-3' });

    assert.equal(matrix.sent.length, 1);
  });

  it('includes artifact count when artifacts are present', async () => {
    const matrix = makeMatrix();
    const taskBridge = makeTaskBridge({
      'OC-4': {
        id: 'OC-4',
        state: 'active',
        team: { members: [{ role: 'executor', agentId: 'haiku' }] },
        subtasks: [{ status: 'completed', output: 'done', done_at: '2026-08-29T00:00:00Z' }],
        artifacts: [
          { artifact_id: 'a1', name: 'patch.diff', media_type: 'text/plain', size_bytes: 1234 },
          { artifact_id: 'a2', name: 'log.txt', media_type: 'text/plain', size_bytes: 567 },
        ],
      },
    });
    const rooms = new Map([['OC-4', '!room:hs']]);
    const posted = new Set();
    const pm = buildPostMortem({ matrix, taskBridge, roomForTask: (id) => rooms.get(id), posted });

    await pm.handleTick({ task_id: 'OC-4' });

    assert.equal(matrix.sent.length, 1);
    assert.match(matrix.sent[0].body, /artifacts: 2/);
  });
});