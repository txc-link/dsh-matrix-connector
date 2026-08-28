/**
 * tests/stuck-list.test.mjs — RED tests for v2.0.2 /agora stuck command.
 *
 * The plugin keeps an in-memory set of tasks it has seen stuck via
 * the SSE inbox_escalated stream. `/agora stuck` reads that set and
 * renders a Markdown summary sorted by idle_ms descending.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderStuckList } from '../lib/stuck-list.js';

describe('renderStuckList', () => {
  it('returns a header-only view when no tasks are stuck', () => {
    const out = renderStuckList({ stuckTasks: [] });
    assert.match(out, /agora stuck/);
    assert.match(out, /0 task/);
  });

  it('renders each stuck task with its task_id and idle_ms', () => {
    const out = renderStuckList({
      stuckTasks: [
        { taskId: 'OC-1', idleMs: 47000, stage: 'execute', agentId: 'haiku', roomId: '!room:hs' },
        { taskId: 'OC-2', idleMs: 120000, stage: 'execute', agentId: 'coder', roomId: '!room:hs' },
      ],
    });
    assert.match(out, /2 task/);
    assert.match(out, /OC-1/);
    assert.match(out, /OC-2/);
    assert.match(out, /47s/);
    assert.match(out, /2m/);
  });

  it('sorts by idle_ms descending so the longest-stuck appears first', () => {
    const out = renderStuckList({
      stuckTasks: [
        { taskId: 'OC-A', idleMs: 30000, stage: 'execute', agentId: 'a', roomId: '!r' },
        { taskId: 'OC-B', idleMs: 90000, stage: 'execute', agentId: 'b', roomId: '!r' },
        { taskId: 'OC-C', idleMs: 60000, stage: 'execute', agentId: 'c', roomId: '!r' },
      ],
    });
    const idxB = out.indexOf('OC-B');
    const idxC = out.indexOf('OC-C');
    const idxA = out.indexOf('OC-A');
    assert.ok(idxB < idxC, 'OC-B (90s) should appear before OC-C (60s)');
    assert.ok(idxC < idxA, 'OC-C (60s) should appear before OC-A (30s)');
  });

  it('hides entries whose roomId is not in the rooms filter', () => {
    const out = renderStuckList({
      stuckTasks: [
        { taskId: 'OC-1', idleMs: 30000, stage: 'execute', agentId: 'a', roomId: '!alpha:hs' },
        { taskId: 'OC-2', idleMs: 60000, stage: 'execute', agentId: 'b', roomId: '!beta:hs' },
      ],
      rooms: new Set(['!alpha:hs']),
    });
    assert.match(out, /1 task/);
    assert.match(out, /OC-1/);
    assert.ok(!out.includes('OC-2'));
  });
});