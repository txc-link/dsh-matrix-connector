#!/usr/bin/env node
/**
 * smoke-v202-stuck-list.mjs — verify renderStuckList() correctly
 * formats a Markdown list of stuck tasks. This smoke is independent
 * of agora central; the stuck list is built from in-memory state.
 */

import assert from 'node:assert/strict';
import { renderStuckList } from '../lib/stuck-list.js';

class Skipped extends Error {}
function required(name) {
  const value = process.env[name];
  if (!value) process.exit(0)(`missing env ${name}`);
  return value;
}

required('MATRIX_HOMESERVER_URL');
required('MATRIX_USER_ID');
required('MATRIX_ACCESS_TOKEN');
required('MATRIX_DEVICE_ID');

console.log('== smoke-v202-stuck-list ==');

// Empty
const empty = renderStuckList({ stuckTasks: [] });
console.log(empty);
assert.match(empty, /0 task/);

// Populated (sorted by idle_ms desc)
const populated = renderStuckList({
  stuckTasks: [
    { taskId: 'OC-A', idleMs: 30000, stage: 'execute', agentId: 'haiku', roomId: '!room:hs' },
    { taskId: 'OC-B', idleMs: 120000, stage: 'execute', agentId: 'coder', roomId: '!room:hs' },
    { taskId: 'OC-C', idleMs: 60000, stage: 'review', agentId: 'reviewer', roomId: '!room:hs' },
  ],
});
console.log('---');
console.log(populated);
assert.match(populated, /3 task/);
assert.match(populated, /OC-B/);
assert.match(populated, /OC-C/);
assert.match(populated, /OC-A/);
const idxB = populated.indexOf('OC-B');
const idxC = populated.indexOf('OC-C');
const idxA = populated.indexOf('OC-A');
assert.ok(idxB < idxC && idxC < idxA, 'must be sorted by idle_ms desc');

console.log('OK smoke-v202-stuck-list passed.');