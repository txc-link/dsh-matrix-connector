/**
 * matrix-room-auto-create.test.mjs — R4 TDD (red → green)
 *
 * Tests matrix Room 自动创建 + thread-registry 持久化 + pull-handler 集成.
 * Spec: Doc/09-PLANNING/TASKS/2026-08-30-matrix-room-auto-create/task_plan.md §6
 *
 * Import style follows the repo convention: compiled `../lib/*.js` (npm test
 * = npm run build && node --test tests/*.test.mjs).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MatrixClient } from '../lib/matrix-client.js';
import {
  handlePullWithRoomCreate,
} from '../lib/pull-handler.js';
import {
  loadThreadRegistry,
  saveThreadRegistry,
} from '../lib/thread-registry.js';

// Helper: build a tmp workspace dir for persistence tests
function tmpWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-r4-'));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// === Test 1: matrix-client createRoom 成功 → 返回 roomId ===
test('R4-1: MatrixClient.createRoom 成功 → 返回 roomId', async () => {
  const transport = {
    createRoom: async (name, opts) => ({ roomId: '!abc:hs.example' }),
  };
  const client = new MatrixClient(transport);
  const receipt = await client.createRoom('Test Room', { topic: 't' });
  assert.ok(receipt.roomId, 'roomId must be set');
  assert.equal(receipt.roomId, '!abc:hs.example');
});

// === Test 2: createRoom 缺 transport 实现 → 抛错 (0 fallback, §1.5) ===
test('R4-2: MatrixClient.createRoom transport 未实现 → 抛错', async () => {
  const client = new MatrixClient({});
  await assert.rejects(client.createRoom('X'), /not implement/);
});

// === Test 3: createRoom transport reject → 错误上抛 ===
test('R4-3: MatrixClient.createRoom transport reject → 抛原错误', async () => {
  const transport = {
    createRoom: async () => { throw new Error('transport down'); },
  };
  const client = new MatrixClient(transport);
  await assert.rejects(client.createRoom('X'), /transport down/);
});

// === Test 4: thread-registry load ENOENT fallback (sandbox) ===
test('R4-4: loadThreadRegistry path 不存在 → 返回空 registry', () => {
  const { dir, cleanup } = tmpWorkspace();
  try {
    const nonExistentPath = join(dir, 'no-such-file.jsonl');
    const registry = loadThreadRegistry(nonExistentPath);
    assert.ok(registry, 'must return a registry instance');
    assert.equal(registry.size(), 0, 'empty registry on ENOENT');
  } finally {
    cleanup();
  }
});

// === Test 5: thread-registry save + load 往返 ===
test('R4-5: saveThreadRegistry + loadThreadRegistry 往返保留 bindings', () => {
  const { dir, cleanup } = tmpWorkspace();
  try {
    const path = join(dir, 'registry.jsonl');
    const reg1 = loadThreadRegistry(path);
    reg1.upsert({
      threadKey: 'mx_test1',
      roomId: '!room1:hs.example',
      placeholderEventId: null,
      taskId: 'task-1',
      createdAt: '2026-08-30T00:00:00Z',
      updatedAt: '2026-08-30T00:00:00Z',
    });
    saveThreadRegistry(reg1, path);

    const reg2 = loadThreadRegistry(path);
    assert.equal(reg2.size(), 1);
    const binding = reg2.get('mx_test1');
    assert.ok(binding, 'binding must persist');
    assert.equal(binding.roomId, '!room1:hs.example');
  } finally {
    cleanup();
  }
});

// === Test 6: thread-registry 双向 lookup (threadKey ↔ roomId) ===
test('R4-6: thread-registry 双向 lookup threadKey ↔ roomId', () => {
  const { dir, cleanup } = tmpWorkspace();
  try {
    const path = join(dir, 'registry.jsonl');
    const reg = loadThreadRegistry(path);
    reg.upsert({
      threadKey: 'mx_lookup1',
      roomId: '!lookup1:hs.example',
      placeholderEventId: null,
      taskId: null,
      createdAt: '2026-08-30T00:00:00Z',
      updatedAt: '2026-08-30T00:00:00Z',
    });
    saveThreadRegistry(reg, path);

    const reg2 = loadThreadRegistry(path);
    assert.equal(reg2.get('mx_lookup1').roomId, '!lookup1:hs.example');
    assert.equal(reg2.getByRoomId('!lookup1:hs.example').threadKey, 'mx_lookup1');
  } finally {
    cleanup();
  }
});

// === Test 7: pull-handler agora://thread/<new> → 自动创建 Room ===
test('R4-7: handlePullWithRoomCreate agora://thread/<new> Auto → executed + roomId 新建', async () => {
  const { dir, cleanup } = tmpWorkspace();
  try {
    const res = await handlePullWithRoomCreate({
      actor: 'agent:matrix-bridge',
      op: 'write',
      uri: 'agora://thread/mx_new123',
      registryPath: join(dir, 'registry.jsonl'),
      posture: 'Auto',
      createRoom: async () => ({ roomId: '!new123:hs.example' }),
    });
    assert.equal(res.status, 'executed');
    assert.ok(res.roomId, 'roomId must be set on new thread');
    assert.equal(res.roomId, '!new123:hs.example');
    assert.equal(res.threadKey, 'mx_new123');
  } finally {
    cleanup();
  }
});

// === Test 8: pull-handler agora://thread/<existing> → 复用 registry roomId ===
test('R4-8: handlePullWithRoomCreate agora://thread/<existing> → executed + 复用 roomId', async () => {
  const { dir, cleanup } = tmpWorkspace();
  try {
    const path = join(dir, 'registry.jsonl');
    let created = 0;
    const createRoom = async () => { created += 1; return { roomId: `!room${created}:hs.example` }; };
    const req = {
      actor: 'agent:matrix-bridge',
      op: 'write',
      uri: 'agora://thread/mx_exist1',
      registryPath: path,
      posture: 'Auto',
      createRoom,
    };
    const res1 = await handlePullWithRoomCreate(req);
    const res2 = await handlePullWithRoomCreate(req);
    assert.equal(res1.status, 'executed');
    assert.equal(res2.status, 'executed');
    assert.equal(res2.roomId, res1.roomId, 'must reuse existing roomId');
    assert.equal(created, 1, 'createRoom called exactly once');
  } finally {
    cleanup();
  }
});

// === Test 9: pull-handler Strict posture → requires_confirm (不创建) ===
test('R4-9: handlePullWithRoomCreate Strict posture → requires_confirm', async () => {
  const { dir, cleanup } = tmpWorkspace();
  try {
    let created = 0;
    const res = await handlePullWithRoomCreate({
      actor: 'human:dashboard',
      op: 'write',
      uri: 'agora://thread/mx_strict1',
      registryPath: join(dir, 'registry.jsonl'),
      posture: 'Strict',
      createRoom: async () => { created += 1; return { roomId: '!x:hs' }; },
    });
    assert.equal(res.status, 'requires_confirm');
    assert.equal(created, 0, 'Strict must not create room');
  } finally {
    cleanup();
  }
});

// === Test 10: pull-handler Dangerous posture → requires_confirm + dualApprovalRequired ===
test('R4-10: handlePullWithRoomCreate Dangerous posture → requires_confirm + dualApprovalRequired=true', async () => {
  const { dir, cleanup } = tmpWorkspace();
  try {
    const res = await handlePullWithRoomCreate({
      actor: 'risky-actor',
      op: 'write',
      uri: 'agora://thread/mx_danger1',
      registryPath: join(dir, 'registry.jsonl'),
      posture: 'Dangerous',
    });
    assert.equal(res.status, 'requires_confirm');
    assert.equal(res.dualApprovalRequired, true, 'Dangerous posture needs dual approval');
  } finally {
    cleanup();
  }
});

// === Test 11: pull-handler audit trail 记录 room_created event ===
test('R4-11: handlePullWithRoomCreate 触发 audit trail room_created event', async () => {
  const { dir, cleanup } = tmpWorkspace();
  try {
    const auditPath = join(dir, 'audit.jsonl');
    const res = await handlePullWithRoomCreate({
      actor: 'agent:matrix-bridge',
      op: 'write',
      uri: 'agora://thread/mx_audit1',
      registryPath: join(dir, 'registry.jsonl'),
      auditPath,
      posture: 'Auto',
      createRoom: async () => ({ roomId: '!audit1:hs.example' }),
    });
    assert.equal(res.status, 'executed');
    assert.ok(existsSync(auditPath), 'audit file must exist');
    const content = readFileSync(auditPath, 'utf8');
    assert.match(content, /room_created/, 'audit must record room_created event');
  } finally {
    cleanup();
  }
});

// === Test 12: pull-handler URI 解析失败 → status=error (不创建 room) ===
test('R4-12: handlePullWithRoomCreate URI 无效 → status=error + 不创建 room', async () => {
  const { dir, cleanup } = tmpWorkspace();
  try {
    let created = 0;
    const res = await handlePullWithRoomCreate({
      actor: 'agent:matrix-bridge',
      op: 'write',
      uri: 'agora://INVALID-URI',
      registryPath: join(dir, 'registry.jsonl'),
      posture: 'Auto',
      createRoom: async () => { created += 1; return { roomId: '!x:hs' }; },
    });
    assert.equal(res.status, 'error');
    assert.equal(res.roomId, undefined, 'no roomId on error');
    assert.equal(created, 0, 'no room created on parse error');
  } finally {
    cleanup();
  }
});
