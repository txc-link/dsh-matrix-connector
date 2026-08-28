#!/usr/bin/env node
/**
 * smoke-v101-rollup.mjs — verifies that renderRollup() correctly
 * shapes a Markdown report from an in-memory task/room snapshot.
 *
 * This smoke does not boot the plugin; it exercises the pure
 * renderRollup() contract that the plugin's /agora rollup case uses.
 */

import assert from 'node:assert/strict';
import { renderRollup } from '../lib/rollup.js';

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

console.log('== smoke-v101-rollup ==');

// Empty input
const empty = renderRollup({ rooms: [], tasks: [] });
console.log(empty);
assert.match(empty, /org war room/);
assert.match(empty, /0 room/);
assert.match(empty, /0 task/);

// Populated input
const populated = renderRollup({
  rooms: ['!alpha:hs', '!beta:hs'],
  tasks: [
    { id: 'OC-1', roomId: '!alpha:hs', state: 'active', agentId: 'reviewer' },
    { id: 'OC-2', roomId: '!alpha:hs', state: 'done', agentId: 'coder' },
    { id: 'OC-3', roomId: '!beta:hs', state: 'active', agentId: 'tester' },
  ],
});
console.log('---');
console.log(populated);
assert.match(populated, /2 room/);
assert.match(populated, /3 task/);
assert.match(populated, /reviewer/);
assert.match(populated, /tester/);

console.log('OK smoke-v101-rollup passed.');