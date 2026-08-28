/**
 * message-router unit tests.
 *
 * Pure-function behaviour; no I/O.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HELP_TEXT, renderError, route } from '../lib/message-router.js';

test('route: /agora help returns verb=help with empty args', () => {
  const d = route('/agora help');
  assert.equal(d.verb, 'help');
  assert.deepEqual(d.args, []);
});

test('route: /agora citizen list → citizen / list', () => {
  const d = route('/agora citizen list');
  assert.equal(d.verb, 'citizen');
  assert.equal(d.subVerb, 'list');
});

test('route: /agora citizen show <id> → citizen / show / <id>', () => {
  const d = route('/agora citizen show cit-42');
  assert.equal(d.verb, 'citizen');
  assert.equal(d.subVerb, 'show');
  assert.deepEqual(d.args, ['cit-42']);
});

test('route: /agora citizen show without id → MISSING_ARG', () => {
  const d = route('/agora citizen show');
  assert.equal(d.errorCode, 'MISSING_ARG');
  assert.equal(d.subVerb, 'show');
});

test('route: /agora dispatch <prompt> → dispatch / <prompt>', () => {
  const d = route('/agora dispatch ask REMOTE_OK');
  assert.equal(d.verb, 'dispatch');
  assert.deepEqual(d.args, ['ask', 'REMOTE_OK']);
});

test('route: /agora dispatch empty → MISSING_ARG', () => {
  const d = route('/agora dispatch');
  assert.equal(d.errorCode, 'MISSING_ARG');
  assert.equal(d.verb, 'dispatch');
});

test('route: /agora brain search <query> → brain / search / <query>', () => {
  const d = route('/agora brain search dispatch 协议');
  assert.equal(d.verb, 'brain');
  assert.equal(d.subVerb, 'search');
  assert.deepEqual(d.args, ['dispatch', '协议']);
});

test('route: /agora brain without search → INVALID_SYNTAX', () => {
  const d = route('/agora brain');
  assert.equal(d.errorCode, 'INVALID_SYNTAX');
});

test('route: non-recognised prefix → UNKNOWN_VERB', () => {
  const d = route('hello world');
  assert.equal(d.verb, 'unknown');
  assert.equal(d.errorCode, 'UNKNOWN_VERB');
});

test('route: empty command body → help', () => {
  const d = route('/agora');
  assert.equal(d.verb, 'help');
});

test('renderError: UNKNOWN_VERB mentions /agora help', () => {
  assert.match(renderError({ verb: 'unknown', args: [], errorCode: 'UNKNOWN_VERB' }), /\/agora help/);
});

test('renderError: MISSING_ARG echoes usage', () => {
  const out = renderError({ verb: 'dispatch', args: [], errorCode: 'MISSING_ARG' });
  assert.match(out, /\/agora dispatch/);
});

test('renderError: INVALID_SYNTAX mentions /agora help', () => {
  assert.match(renderError({ verb: 'brain', args: [], errorCode: 'INVALID_SYNTAX' }), /\/agora help/);
});

test('HELP_TEXT: contains every v0.1 verb', () => {
  for (const v of ['citizen', 'dispatch', 'task', 'artifact', 'brain', 'im', 'help']) {
    assert.match(HELP_TEXT, new RegExp(v));
  }
});