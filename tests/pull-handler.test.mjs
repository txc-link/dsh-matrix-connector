#!/usr/bin/env node
/**
 * pull-handler.test.mjs — Slice 4 TDD tests for src/pull-handler.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

let handlePull;

try {
  const mod = await import('../lib/pull-handler.js');
  handlePull = mod.handlePull;
} catch (e) {
  handlePull = () => {
    throw new Error('TDD RED: lib/pull-handler.js not built yet');
  };
}

test('handlePull: dashboard + delete + task → requires_confirm', () => {
  const r = handlePull({ actor: 'human:dashboard', op: 'delete', uri: 'agora://task/Ta-1' });
  assert.equal(r.status, 'requires_confirm');
  assert.equal(r.posture?.posture, 'Dangerous');
});

test('handlePull: dashboard + read + task → executed', () => {
  const r = handlePull({ actor: 'human:dashboard', op: 'read', uri: 'agora://task/Ta-1' });
  assert.equal(r.status, 'executed');
});

test('handlePull: claude-code + read + task → executed (Auto)', () => {
  const r = handlePull({ actor: 'agent:claude-code', op: 'read', uri: 'agora://task/Ta-1' });
  assert.equal(r.status, 'executed');
  assert.equal(r.posture?.posture, 'Auto');
});

test('handlePull: matrix-bridge + write + task → denied (ACL)', () => {
  const r = handlePull({ actor: 'agent:matrix-bridge', op: 'write', uri: 'agora://task/Ta-1' });
  assert.equal(r.status, 'denied');
  assert.equal(r.acl?.decision, 'deny');
});

test('handlePull: matrix-bridge + read + event → executed', () => {
  const r = handlePull({ actor: 'agent:matrix-bridge', op: 'read', uri: 'agora://event/Ev-1' });
  assert.equal(r.status, 'executed');
});

test('handlePull: invalid URI → error', () => {
  const r = handlePull({ actor: 'human:dashboard', op: 'read', uri: 'http://task/Ta-1' });
  assert.equal(r.status, 'error');
});

test('handlePull: unknown actor → denied', () => {
  const r = handlePull({ actor: 'agent:unknown', op: 'read', uri: 'agora://task/Ta-1' });
  assert.equal(r.status, 'denied');
});

test('handlePull: audit record written for executed', () => {
  const r = handlePull({ actor: 'human:dashboard', op: 'read', uri: 'agora://task/Ta-99' });
  assert.ok(r.audit);
  assert.ok(r.audit.ts);
  assert.equal(r.audit.result, 'pass');
});

test('handlePull: parsed URI present for valid input', () => {
  const r = handlePull({ actor: 'human:dashboard', op: 'read', uri: 'agora://event/Ev-1' });
  assert.ok(r.parsed);
  assert.equal(r.parsed.type, 'event');
  assert.equal(r.parsed.id, 'Ev-1');
});
