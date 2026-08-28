#!/usr/bin/env node
/**
 * posture-middleware.test.mjs — Slice 2 TDD tests for src/posture-middleware.ts
 *
 * Run: node --test tests/posture-middleware.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgoraUri } from '../lib/uri-parser.js';

let resolvePosture, POSTURE_TABLE;

try {
  const mod = await import('../lib/posture-middleware.js');
  resolvePosture = mod.resolvePosture;
  POSTURE_TABLE = mod.POSTURE_TABLE;
} catch (e) {
  resolvePosture = () => {
    throw new Error('TDD RED: lib/posture-middleware.js not built yet');
  };
  POSTURE_TABLE = new Map();
}

test('resolvePosture: claude-code + task + write → Strict', () => {
  const uri = parseAgoraUri('agora://task/Ta-1');
  const d = resolvePosture({ actor: 'agent:claude-code', uri, op: 'write' });
  assert.equal(d.posture, 'Strict');
  assert.equal(d.requiresConfirm, false);
});

test('resolvePosture: claude-code + event + read → Auto', () => {
  const uri = parseAgoraUri('agora://event/Ev-1');
  const d = resolvePosture({ actor: 'agent:claude-code', uri, op: 'read' });
  assert.equal(d.posture, 'Auto');
  assert.equal(d.requiresConfirm, false);
});

test('resolvePosture: dashboard + task + delete → Dangerous', () => {
  const uri = parseAgoraUri('agora://task/Ta-1');
  const d = resolvePosture({ actor: 'human:dashboard', uri, op: 'delete' });
  assert.equal(d.posture, 'Dangerous');
  assert.equal(d.requiresConfirm, true);
});

test('resolvePosture: matrix-bridge + event + read → Auto', () => {
  const uri = parseAgoraUri('agora://event/Ev-1');
  const d = resolvePosture({ actor: 'agent:matrix-bridge', uri, op: 'read' });
  assert.equal(d.posture, 'Auto');
  assert.equal(d.requiresConfirm, false);
});

test('resolvePosture: matrix-bridge + task + write → Strict', () => {
  const uri = parseAgoraUri('agora://task/Ta-1');
  const d = resolvePosture({ actor: 'agent:matrix-bridge', uri, op: 'write' });
  assert.equal(d.posture, 'Strict');
});

test('resolvePosture: unknown actor → Strict (default fail-safe)', () => {
  const uri = parseAgoraUri('agora://task/Ta-1');
  const d = resolvePosture({ actor: 'agent:unknown', uri, op: 'read' });
  assert.equal(d.posture, 'Strict');
});

test('resolvePosture: delete op → Dangerous', () => {
  const uri = parseAgoraUri('agora://event/Ev-1');
  const d = resolvePosture({ actor: 'agent:claude-code', uri, op: 'delete' });
  assert.equal(d.posture, 'Dangerous');
  assert.equal(d.requiresConfirm, true);
});

test('POSTURE_TABLE contains Strict/Auto/Dangerous', () => {
  const postures = new Set();
  for (const v of POSTURE_TABLE.values()) postures.add(v);
  assert.ok(postures.has('Strict'));
  assert.ok(postures.has('Auto'));
  assert.ok(postures.has('Dangerous'));
});

test('resolvePosture: reason field non-empty', () => {
  const uri = parseAgoraUri('agora://task/Ta-1');
  const d = resolvePosture({ actor: 'agent:claude-code', uri, op: 'read' });
  assert.ok(d.reason && d.reason.length > 0);
});
