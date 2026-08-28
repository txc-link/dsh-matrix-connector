#!/usr/bin/env node
/**
 * audit-trail.test.mjs — Slice 2 TDD tests for src/audit-trail.ts
 *
 * Run: node --test tests/audit-trail.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let appendAuditRecord, readAuditRecords, AuditRecord, DEFAULT_AUDIT_PATH;

try {
  const mod = await import('../lib/audit-trail.js');
  appendAuditRecord = mod.appendAuditRecord;
  readAuditRecords = mod.readAuditRecords;
  DEFAULT_AUDIT_PATH = mod.DEFAULT_AUDIT_PATH;
} catch (e) {
  appendAuditRecord = () => {
    throw new Error('TDD RED: lib/audit-trail.js not built yet');
  };
  readAuditRecords = () => {
    throw new Error('TDD RED: lib/audit-trail.js not built yet');
  };
  DEFAULT_AUDIT_PATH = '/tmp/null';
}

// Use tmp dir for tests to avoid polluting real ~/.agora/
const TEST_DIR = mkdtempSync(join(tmpdir(), 'audit-trail-test-'));
const TEST_PATH = join(TEST_DIR, 'audit.jsonl');

test('DEFAULT_AUDIT_PATH points to ~/.agora/audit-trail/dsh-matrix-connector.jsonl', () => {
  assert.match(DEFAULT_AUDIT_PATH, /\.agora[\\/]audit-trail[\\/]dsh-matrix-connector\.jsonl$/);
});

test('appendAuditRecord writes JSONL line', () => {
  const rec = {
    ts: '2026-08-29T04:00:00.000Z',
    actor: 'agent:claude-code',
    uri: 'agora://task/Ta-1',
    op: 'write',
    posture: 'Strict',
    result: 'pass',
    requiresConfirm: false,
  };
  appendAuditRecord(rec, TEST_PATH);
  const records = readAuditRecords(TEST_PATH);
  assert.equal(records.length, 1);
  assert.equal(records[0].actor, 'agent:claude-code');
});

test('appendAuditRecord: append (not overwrite)', () => {
  const rec1 = {
    ts: '2026-08-29T04:01:00.000Z',
    actor: 'a1',
    uri: 'agora://event/Ev-1',
    op: 'read',
    posture: 'Auto',
    result: 'pass',
    requiresConfirm: false,
  };
  const rec2 = {
    ts: '2026-08-29T04:02:00.000Z',
    actor: 'a2',
    uri: 'agora://task/Ta-2',
    op: 'write',
    posture: 'Strict',
    result: 'pass',
    requiresConfirm: false,
  };
  appendAuditRecord(rec1, TEST_PATH);
  appendAuditRecord(rec2, TEST_PATH);
  const records = readAuditRecords(TEST_PATH);
  assert.equal(records.length, 3); // 1 from previous test + 2 new
  assert.equal(records[records.length - 1].actor, 'a2');
});

test('audit record schema has all required fields', () => {
  const rec = {
    ts: '2026-08-29T04:03:00.000Z',
    actor: 'a3',
    uri: 'agora://task/Ta-3',
    op: 'delete',
    posture: 'Dangerous',
    result: 'pass',
    requiresConfirm: true,
  };
  appendAuditRecord(rec, TEST_PATH);
  const records = readAuditRecords(TEST_PATH);
  const last = records[records.length - 1];
  assert.ok(last.ts);
  assert.ok(last.actor);
  assert.ok(last.uri);
  assert.ok(last.op);
  assert.ok(last.posture);
  assert.ok(last.result);
  assert.equal(typeof last.requiresConfirm, 'boolean');
});

test('audit record with result=fail has error field', () => {
  const rec = {
    ts: '2026-08-29T04:04:00.000Z',
    actor: 'a4',
    uri: 'agora://task/Ta-4',
    op: 'write',
    posture: 'Strict',
    result: 'fail',
    error: 'actor not permitted',
    requiresConfirm: false,
  };
  appendAuditRecord(rec, TEST_PATH);
  const records = readAuditRecords(TEST_PATH);
  const fail = records.find((r) => r.result === 'fail' && r.actor === 'a4');
  assert.ok(fail);
  assert.ok(fail.error);
  assert.match(fail.error, /not permitted/i);
});

// Cleanup
test('cleanup', () => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});
