/**
 * thread-registry unit tests.
 *
 * Verifies opaque threadKey ↔ matrix room mapping.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ThreadRegistry, buildThreadKey } from '../lib/thread-registry.js';

test('buildThreadKey: same roomId produces same threadKey', () => {
  const a = buildThreadKey('!abc:hs');
  const b = buildThreadKey('!abc:hs');
  assert.equal(a, b);
  assert.match(a, /^mx_[0-9a-f]{16}$/);
});

test('buildThreadKey: different roomIds produce different threadKeys', () => {
  const a = buildThreadKey('!abc:hs');
  const b = buildThreadKey('!def:hs');
  assert.notEqual(a, b);
});

test('ThreadRegistry: upsertPlaceholder binds threadKey → room + eventId', () => {
  const r = new ThreadRegistry();
  const tk = buildThreadKey('!room:hs');
  const b = r.upsertPlaceholder(tk, '!room:hs', 'evt_1', 'task_99');
  assert.equal(b.threadKey, tk);
  assert.equal(b.roomId, '!room:hs');
  assert.equal(b.placeholderEventId, 'evt_1');
  assert.equal(b.taskId, 'task_99');
});

test('ThreadRegistry: resolveTaskId finds the binding', () => {
  const r = new ThreadRegistry();
  const tk = buildThreadKey('!room:hs');
  r.upsertPlaceholder(tk, '!room:hs', 'evt_1', 'task_99');
  const b = r.resolveTaskId('task_99');
  assert.ok(b);
  assert.equal(b.threadKey, tk);
});

test('ThreadRegistry: has/get returns false for missing keys', () => {
  const r = new ThreadRegistry();
  assert.equal(r.has('mx_doesnotexist'), false);
  assert.equal(r.get('mx_doesnotexist'), undefined);
});

test('ThreadRegistry: size / clear lifecycle', () => {
  const r = new ThreadRegistry();
  r.upsertPlaceholder('mx_a', '!a:hs', 'e1', 't1');
  r.upsertPlaceholder('mx_b', '!b:hs', 'e2', 't2');
  assert.equal(r.size(), 2);
  r.clear();
  assert.equal(r.size(), 0);
});