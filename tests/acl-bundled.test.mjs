#!/usr/bin/env node
/**
 * acl-bundled.test.mjs — Slice 3 TDD tests for src/acl-bundled.ts
 *
 * Run: node --test tests/acl-bundled.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgoraUri } from '../lib/uri-parser.js';

let checkAcl, ACL_TABLE;

try {
  const mod = await import('../lib/acl-bundled.js');
  checkAcl = mod.checkAcl;
  ACL_TABLE = mod.ACL_TABLE;
} catch (e) {
  checkAcl = () => {
    throw new Error('TDD RED: lib/acl-bundled.js not built yet');
  };
  ACL_TABLE = new Map();
}

test('checkAcl: dashboard + any URI + any op → allow', () => {
  const uri = parseAgoraUri('agora://task/Ta-1');
  assert.equal(
    checkAcl({ actor: 'human:dashboard', uri, op: 'delete' }).decision,
    'allow',
  );
});

test('checkAcl: claude-code + task + read → allow', () => {
  const uri = parseAgoraUri('agora://task/Ta-1');
  assert.equal(
    checkAcl({ actor: 'agent:claude-code', uri, op: 'read' }).decision,
    'allow',
  );
});

test('checkAcl: claude-code + task + delete → deny', () => {
  const uri = parseAgoraUri('agora://task/Ta-1');
  assert.equal(
    checkAcl({ actor: 'agent:claude-code', uri, op: 'delete' }).decision,
    'deny',
  );
});

test('checkAcl: claude-code + event + read → allow', () => {
  const uri = parseAgoraUri('agora://event/Ev-1');
  assert.equal(
    checkAcl({ actor: 'agent:claude-code', uri, op: 'read' }).decision,
    'allow',
  );
});

test('checkAcl: matrix-bridge + event + read → allow', () => {
  const uri = parseAgoraUri('agora://event/Ev-1');
  assert.equal(
    checkAcl({ actor: 'agent:matrix-bridge', uri, op: 'read' }).decision,
    'allow',
  );
});

test('checkAcl: matrix-bridge + task + write → deny', () => {
  const uri = parseAgoraUri('agora://task/Ta-1');
  assert.equal(
    checkAcl({ actor: 'agent:matrix-bridge', uri, op: 'write' }).decision,
    'deny',
  );
});

test('checkAcl: matrix-bridge + task + read → deny', () => {
  const uri = parseAgoraUri('agora://task/Ta-1');
  assert.equal(
    checkAcl({ actor: 'agent:matrix-bridge', uri, op: 'read' }).decision,
    'deny',
  );
});

test('checkAcl: postmortem-bot + task + read (sub=postmortem) → allow', () => {
  const uri = parseAgoraUri('agora://task/Ta-1/postmortem');
  assert.equal(
    checkAcl({ actor: 'agent:postmortem-bot', uri, op: 'read' }).decision,
    'allow',
  );
});

test('checkAcl: postmortem-bot + task + read (no sub) → deny', () => {
  const uri = parseAgoraUri('agora://task/Ta-1');
  assert.equal(
    checkAcl({ actor: 'agent:postmortem-bot', uri, op: 'read' }).decision,
    'deny',
  );
});

test('checkAcl: unknown actor → deny', () => {
  const uri = parseAgoraUri('agora://task/Ta-1');
  assert.equal(
    checkAcl({ actor: 'agent:unknown-bot', uri, op: 'read' }).decision,
    'deny',
  );
});

test('ACL_TABLE has at least 4 entries', () => {
  assert.ok(ACL_TABLE.size >= 4, `ACL_TABLE.size = ${ACL_TABLE.size}`);
});

test('checkAcl: reason field non-empty', () => {
  const uri = parseAgoraUri('agora://task/Ta-1');
  const d = checkAcl({ actor: 'human:dashboard', uri, op: 'write' });
  assert.ok(d.reason && d.reason.length > 0);
});
