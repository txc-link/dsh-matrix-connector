/**
 * room-name.test.mjs — RED-first unit tests for buildRoomName.
 *
 * §1 boundary: pure function, no I/O. Matrix room name rules:
 *   - UTF-8 allowed (中文 OK)
 *   - max 255 chars
 *   - control chars / null should be stripped
 *   - whitespace collapsed for readability
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRoomName } from '../lib/room-name.js';

test('room-name: plain title passes through', () => {
  assert.equal(buildRoomName('任务标题'), '任务标题');
  assert.equal(buildRoomName('Implement matrix bridge'), 'Implement matrix bridge');
});

test('room-name: optional taskId prefix', () => {
  assert.equal(buildRoomName('Fix login bug', 'T-42'), '[T-42] Fix login bug');
});

test('room-name: strips control characters', () => {
  const input = 'bad\u0000name\u0007with\u001bcontrol';
  assert.equal(buildRoomName(input), 'bad name with control');
});

test('room-name: collapses whitespace', () => {
  assert.equal(buildRoomName('  double   spaced  \n title '), 'double spaced title');
});

test('room-name: truncates at 255 chars', () => {
  const long = 'x'.repeat(300);
  const result = buildRoomName(long);
  assert.ok(result.length <= 255, `length ${result.length} <= 255`);
});

test('room-name: empty/blank title yields fallback', () => {
  assert.equal(buildRoomName(''), 'untitled-task');
  assert.equal(buildRoomName('   '), 'untitled-task');
});

test('room-name: prefix included in truncation budget', () => {
  const long = 'y'.repeat(260);
  const result = buildRoomName(long, 'T-99');
  assert.ok(result.length <= 255, `length ${result.length} <= 255`);
  assert.ok(result.startsWith('[T-99]'), 'prefix preserved');
});
