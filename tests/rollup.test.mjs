/**
 * tests/rollup.test.mjs — RED tests for v1.0.1 org war-room rollup.
 *
 * The rollup view is a single Markdown report covering:
 *   - every room the plugin has seen (via ThreadRegistry) and the count
 *     of in-flight tasks in each room
 *   - every task the plugin knows about and its executor + state
 *
 * The view is read-only and purely derives from in-memory state. No
 * new agora central endpoint is called.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderRollup } from '../lib/rollup.js';

describe('renderRollup', () => {
  it('returns a header-only view when there are no rooms or tasks', () => {
    const out = renderRollup({ rooms: [], tasks: [] });
    assert.match(out, /org war room/);
    assert.match(out, /0 room/);
    assert.match(out, /0 task/);
  });

  it('groups tasks by room and reports active vs done counts', () => {
    const out = renderRollup({
      rooms: ['!alpha:hs', '!beta:hs'],
      tasks: [
        { id: 'OC-1', roomId: '!alpha:hs', state: 'active', agentId: 'reviewer' },
        { id: 'OC-2', roomId: '!alpha:hs', state: 'active', agentId: 'coder' },
        { id: 'OC-3', roomId: '!beta:hs', state: 'done', agentId: 'tester' },
      ],
    });
    assert.match(out, /2 room/);
    assert.match(out, /3 task/);
    assert.match(out, /!alpha:hs/);
    assert.match(out, /2 active/);
    assert.match(out, /1 done/);
  });

  it('does not double-count tasks that appear in multiple lists', () => {
    const out = renderRollup({
      rooms: ['!alpha:hs'],
      tasks: [
        { id: 'OC-1', roomId: '!alpha:hs', state: 'active', agentId: 'a' },
        { id: 'OC-1', roomId: '!alpha:hs', state: 'active', agentId: 'a' },
      ],
    });
    // Dedupe by id.
    assert.match(out, /1 task/);
  });

  it('mentions the executor agentId for each task', () => {
    const out = renderRollup({
      rooms: ['!alpha:hs'],
      tasks: [{ id: 'OC-1', roomId: '!alpha:hs', state: 'active', agentId: 'reviewer' }],
    });
    assert.match(out, /reviewer/);
  });

  it('ignores tasks whose roomId is not in the rooms list', () => {
    const out = renderRollup({
      rooms: ['!alpha:hs'],
      tasks: [{ id: 'OC-1', roomId: '!other:hs', state: 'active', agentId: 'reviewer' }],
    });
    assert.match(out, /0 task/);
  });
});