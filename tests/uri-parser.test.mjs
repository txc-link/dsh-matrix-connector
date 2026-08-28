#!/usr/bin/env node
/**
 * uri-parser.test.mjs — Slice 1 TDD tests for src/uri-parser.ts
 *
 * Coverage: 22 cases per spec-slice-1-uri-parser.md §6.1
 *  - 13 happy path
 *  - 9 invalid path
 *
 * Run: node --test tests/uri-parser.test.mjs
 * Must NOT break: tests/*.test.mjs (87/87 baseline)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import from compiled lib/ (after npm run build); fall back to ts source
// import path strategy: try compiled first; in TDD red phase, this file won't exist yet
let parseAgoraUri, validateType, validateId, buildAgoraUri, VALID_TYPES, ID_PATTERN;

try {
  // eslint-disable-next-line no-unused-vars
  const mod = await import('../lib/uri-parser.js');
  parseAgoraUri = mod.parseAgoraUri;
  validateType = mod.validateType;
  validateId = mod.validateId;
  buildAgoraUri = mod.buildAgoraUri;
  VALID_TYPES = mod.VALID_TYPES;
  ID_PATTERN = mod.ID_PATTERN;
} catch (e) {
  // TDD red phase: lib/uri-parser.js doesn't exist yet
  // Tests will fail with "is not a function" or "Cannot read properties of undefined"
  parseAgoraUri = () => {
    throw new Error('TDD RED: lib/uri-parser.js not built yet');
  };
  validateType = () => {
    throw new Error('TDD RED: lib/uri-parser.js not built yet');
  };
  validateId = () => {
    throw new Error('TDD RED: lib/uri-parser.js not built yet');
  };
  buildAgoraUri = () => {
    throw new Error('TDD RED: lib/uri-parser.js not built yet');
  };
  VALID_TYPES = new Set();
  ID_PATTERN = null;
}

// ===== Happy path tests (13 cases) =====

test('parseAgoraUri: simple task URI', () => {
  const r = parseAgoraUri('agora://task/Ta-123');
  assert.equal(r.scheme, 'agora');
  assert.equal(r.type, 'task');
  assert.equal(r.id, 'Ta-123');
  assert.equal(r.sub, undefined);
});

test('parseAgoraUri: event URI with hyphenated id', () => {
  const r = parseAgoraUri('agora://event/Ev-abc-456');
  assert.equal(r.type, 'event');
  assert.equal(r.id, 'Ev-abc-456');
});

test('parseAgoraUri: participant URI', () => {
  const r = parseAgoraUri('agora://participant/Pa-1');
  assert.equal(r.type, 'participant');
  assert.equal(r.id, 'Pa-1');
});

test('parseAgoraUri: execution URI with multi-segment id', () => {
  const r = parseAgoraUri('agora://execution/Xe-foo-bar');
  assert.equal(r.type, 'execution');
  assert.equal(r.id, 'Xe-foo-bar');
});

test('parseAgoraUri: URI with sub-path', () => {
  const r = parseAgoraUri('agora://task/Ta-123/postmortem');
  assert.equal(r.type, 'task');
  assert.equal(r.id, 'Ta-123');
  assert.equal(r.sub, 'postmortem');
});

test('parseAgoraUri: sub-path containing slash', () => {
  const r = parseAgoraUri('agora://event/Ev-1/tick/state');
  assert.equal(r.type, 'event');
  assert.equal(r.id, 'Ev-1');
  assert.equal(r.sub, 'tick/state');
});

test('validateType: accepts task', () => {
  assert.equal(validateType('task'), true);
});

test('validateType: rejects unknown type', () => {
  assert.equal(validateType('unknown'), false);
});

test('validateId: accepts standard id', () => {
  assert.equal(validateId('Ta-123'), true);
});

test('validateId: rejects lowercase prefix', () => {
  assert.equal(validateId('t-1'), false);
});

test('validateId: rejects empty body', () => {
  assert.equal(validateId('T-'), false);
});

test('validateId: rejects missing prefix', () => {
  assert.equal(validateId('123'), false);
});

// Note: "multi-word prefix" rejection removed — grammar ([A-Z][a-z]+ = 1
// uppercase + 1+ lowercase) cannot distinguish single-word vs multi-word
// prefix. Both `Ta-1` and `Task-1` are valid by spec grammar. The body
// separator `-` is the boundary; "multi-word" is meaningless in this grammar.

test('buildAgoraUri: simple case', () => {
  assert.equal(buildAgoraUri({ type: 'task', id: 'Ta-123' }), 'agora://task/Ta-123');
});

test('buildAgoraUri: with sub', () => {
  assert.equal(
    buildAgoraUri({ type: 'task', id: 'Ta-123', sub: 'postmortem' }),
    'agora://task/Ta-123/postmortem',
  );
});

// ===== Invalid path tests (7 cases) =====

test('parseAgoraUri: throws on wrong scheme', () => {
  assert.throws(() => parseAgoraUri('http://task/Ta-123'), /invalid scheme/i);
});

test('parseAgoraUri: throws on missing type', () => {
  assert.throws(() => parseAgoraUri('agora://'), /missing type/i);
});

test('parseAgoraUri: throws on missing id', () => {
  assert.throws(() => parseAgoraUri('agora://task/'), /missing id/i);
});

test('parseAgoraUri: throws on invalid type', () => {
  assert.throws(() => parseAgoraUri('agora://foo/x-1'), /invalid type/i);
});

test('parseAgoraUri: throws on invalid id pattern', () => {
  assert.throws(() => parseAgoraUri('agora://task/x-1'), /invalid id/i);
});

test('parseAgoraUri: throws on empty input', () => {
  assert.throws(() => parseAgoraUri(''), /empty input/i);
});

test('parseAgoraUri: throws on trailing slash without sub', () => {
  assert.throws(() => parseAgoraUri('agora://task/Ta-123/'), /empty sub/i);
});

// ===== Constants tests =====

test('VALID_TYPES: contains all 4 valid types', () => {
  assert.ok(VALID_TYPES.has('task'));
  assert.ok(VALID_TYPES.has('event'));
  assert.ok(VALID_TYPES.has('participant'));
  assert.ok(VALID_TYPES.has('execution'));
  assert.equal(VALID_TYPES.size, 4);
});

test('ID_PATTERN: matches Ta-123', () => {
  assert.equal(ID_PATTERN.test('Ta-123'), true);
});

test('ID_PATTERN: rejects lowercase prefix', () => {
  assert.equal(ID_PATTERN.test('t-1'), false);
});
