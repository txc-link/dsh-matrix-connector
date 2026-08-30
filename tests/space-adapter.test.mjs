/**
 * space-adapter unit tests — v0.6 R-E.1 (TDD red).
 *
 * Tests the public MatrixSpaceAdapter surface against an in-memory stub
 * transport. Real matrix-js-sdk-backed transport implementation lives in
 * R-E.2; here we lock the contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MatrixSpaceAdapter } from '../lib/space-adapter.js';

/**
 * In-memory stub of MatrixSpaceTransport. Records calls, lets tests push
 * synthetic events into subscribed handlers, and exposes a small registry
 * of child rooms per space so isSpace/list/hierarchy can be configured per
 * test.
 */
function makeStubTransport(opts = {}) {
  const spaces = new Map();       // roomId → { name, topic, isSpace }
  const children = new Map();      // spaceId → SpaceChild[]
  const subs = new Map();          // spaceId → [{ childRoomIds, handler }]
  const calls = { isSpace: [], list: [], hierarchy: [], subscribe: [] };

  const transport = {
    async isSpaceRoom(roomId) {
      calls.isSpace.push(roomId);
      return spaces.get(roomId)?.isSpace === true;
    },
    async listChildRooms(spaceId) {
      calls.list.push(spaceId);
      return children.get(spaceId) ?? [];
    },
    async getSpaceHierarchy(spaceId) {
      calls.hierarchy.push(spaceId);
      const meta = spaces.get(spaceId) ?? {};
      const space = {
        spaceId,
        ...(meta.name !== undefined ? { name: meta.name } : {}),
        ...(meta.topic !== undefined ? { topic: meta.topic } : {}),
        children: children.get(spaceId) ?? [],
      };
      // Flatten one level: only direct children appear in childRooms.
      const childRooms = (children.get(spaceId) ?? []).map((c) => {
        const childMeta = spaces.get(c.roomId) ?? {};
        return {
          spaceId: c.roomId,
          ...(childMeta.name !== undefined ? { name: childMeta.name } : {}),
          ...(childMeta.topic !== undefined ? { topic: childMeta.topic } : {}),
          children: children.get(c.roomId) ?? [],
        };
      });
      return { space, childRooms };
    },
    subscribeSpaceEvents(spaceId, childRoomIds, handler) {
      calls.subscribe.push({ spaceId, childRoomIds });
      const list = subs.get(spaceId) ?? [];
      const entry = { childRoomIds, handler };
      list.push(entry);
      subs.set(spaceId, list);
      return () => {
        const cur = subs.get(spaceId) ?? [];
        const idx = cur.indexOf(entry);
        if (idx >= 0) cur.splice(idx, 1);
        subs.set(spaceId, cur);
      };
    },
  };

  return {
    transport,
    spaces,
    children,
    subs,
    calls,
    /** Inject a synthetic event into all handlers registered for `spaceId`. */
    emit(spaceId, event) {
      const list = subs.get(spaceId) ?? [];
      for (const { handler } of list) handler(event);
    },
    ...opts,
  };
}

// ─── isSpace ────────────────────────────────────────────────────────────────

test('space-adapter: isSpace returns true when m.room.create.type === "m.space"', async () => {
  const stub = makeStubTransport();
  stub.spaces.set('!space:hs', { isSpace: true, name: 'root' });
  const adapter = new MatrixSpaceAdapter(stub.transport);
  assert.equal(await adapter.isSpace('!space:hs'), true);
  assert.deepEqual(stub.calls.isSpace, ['!space:hs']);
});

test('space-adapter: isSpace returns false for a non-space room', async () => {
  const stub = makeStubTransport();
  stub.spaces.set('!plain:hs', { isSpace: false, name: 'plain' });
  const adapter = new MatrixSpaceAdapter(stub.transport);
  assert.equal(await adapter.isSpace('!plain:hs'), false);
});

test('space-adapter: isSpace returns false for unknown room (no throw)', async () => {
  const stub = makeStubTransport();
  const adapter = new MatrixSpaceAdapter(stub.transport);
  assert.equal(await adapter.isSpace('!missing:hs'), false);
});

test('space-adapter: isSpace returns false for empty / non-string roomId without calling transport', async () => {
  const stub = makeStubTransport();
  const adapter = new MatrixSpaceAdapter(stub.transport);
  assert.equal(await adapter.isSpace(''), false);
  assert.equal(await adapter.isSpace(undefined), false);
  assert.equal(stub.calls.isSpace.length, 0);
});

// ─── listChildRooms ────────────────────────────────────────────────────────

test('space-adapter: listChildRooms returns ordered + suggested + via fields', async () => {
  const stub = makeStubTransport();
  stub.children.set('!space:hs', [
    { roomId: '!a:hs', order: 'a', suggested: true, via: ['hs'] },
    { roomId: '!b:hs', order: 'b', suggested: false, via: ['hs'] },
  ]);
  const adapter = new MatrixSpaceAdapter(stub.transport);
  const out = await adapter.listChildRooms('!space:hs');
  assert.equal(out.length, 2);
  assert.equal(out[0].roomId, '!a:hs');
  assert.equal(out[0].order, 'a');
  assert.equal(out[0].suggested, true);
  assert.deepEqual(out[0].via, ['hs']);
  assert.equal(out[1].roomId, '!b:hs');
});

test('space-adapter: listChildRooms returns empty array when Space has no children', async () => {
  const stub = makeStubTransport();
  stub.children.set('!empty:hs', []);
  const adapter = new MatrixSpaceAdapter(stub.transport);
  const out = await adapter.listChildRooms('!empty:hs');
  assert.deepEqual(out, []);
});

test('space-adapter: listChildRooms throws on empty spaceId', async () => {
  const stub = makeStubTransport();
  const adapter = new MatrixSpaceAdapter(stub.transport);
  await assert.rejects(
    () => adapter.listChildRooms(''),
    /spaceId is required/,
  );
  await assert.rejects(
    () => adapter.listChildRooms(undefined),
    /spaceId is required/,
  );
});

// ─── getSpaceHierarchy ──────────────────────────────────────────────────────

test('space-adapter: getSpaceHierarchy returns root SpaceRef + flattened child SpaceRefs', async () => {
  const stub = makeStubTransport();
  stub.spaces.set('!space:hs', { isSpace: true, name: 'root', topic: 'top' });
  stub.spaces.set('!a:hs', { isSpace: false, name: 'childA', topic: 'ta' });
  stub.spaces.set('!b:hs', { isSpace: false, name: 'childB', topic: 'tb' });
  stub.children.set('!space:hs', [
    { roomId: '!a:hs', order: 'a', suggested: true, via: ['hs'] },
    { roomId: '!b:hs', order: 'b', suggested: false, via: ['hs'] },
  ]);
  const adapter = new MatrixSpaceAdapter(stub.transport);
  const out = await adapter.getSpaceHierarchy('!space:hs');
  assert.equal(out.space.spaceId, '!space:hs');
  assert.equal(out.space.name, 'root');
  assert.equal(out.space.topic, 'top');
  assert.equal(out.space.children.length, 2);
  assert.equal(out.childRooms.length, 2);
  assert.equal(out.childRooms[0].spaceId, '!a:hs');
  assert.equal(out.childRooms[0].name, 'childA');
  assert.equal(out.childRooms[0].topic, 'ta');
  assert.equal(out.childRooms[1].spaceId, '!b:hs');
});

test('space-adapter: getSpaceHierarchy throws on empty spaceId', async () => {
  const stub = makeStubTransport();
  const adapter = new MatrixSpaceAdapter(stub.transport);
  await assert.rejects(
    () => adapter.getSpaceHierarchy(''),
    /spaceId is required/,
  );
});

// ─── subscribeSpaceEvents ───────────────────────────────────────────────────

test('space-adapter: subscribeSpaceEvents forwards child-added events from the transport', async () => {
  const stub = makeStubTransport();
  stub.children.set('!space:hs', [
    { roomId: '!a:hs', order: 'a', suggested: true, via: ['hs'] },
  ]);
  const adapter = new MatrixSpaceAdapter(stub.transport);
  const received = [];
  const dispose = adapter.subscribeSpaceEvents('!space:hs', (e) => received.push(e));
  // Let the async listChildRooms → subscribe wiring settle.
  await new Promise((r) => setImmediate(r));
  stub.emit('!space:hs', { kind: 'child-added', spaceId: '!space:hs', child: { roomId: '!b:hs', order: 'b', suggested: false } });
  assert.equal(received.length, 1);
  assert.equal(received[0].kind, 'child-added');
  assert.equal(received[0].child.roomId, '!b:hs');
  assert.equal(stub.calls.subscribe.length, 1);
  assert.deepEqual(stub.calls.subscribe[0].childRoomIds, ['!a:hs']);
  dispose();
});

test('space-adapter: subscribeSpaceEvents forwards child-room timeline messages', async () => {
  const stub = makeStubTransport();
  stub.children.set('!space:hs', [{ roomId: '!a:hs' }]);
  const adapter = new MatrixSpaceAdapter(stub.transport);
  const received = [];
  const dispose = adapter.subscribeSpaceEvents('!space:hs', (e) => received.push(e));
  await new Promise((r) => setImmediate(r));
  stub.emit('!space:hs', {
    kind: 'message',
    spaceId: '!space:hs',
    childRoomId: '!a:hs',
    eventId: '$evt_1',
    sender: '@user:hs',
    body: 'hello from child',
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].kind, 'message');
  assert.equal(received[0].childRoomId, '!a:hs');
  assert.equal(received[0].body, 'hello from child');
  dispose();
});

test('space-adapter: subscribeSpaceEvents disposer removes the transport subscription', async () => {
  const stub = makeStubTransport();
  stub.children.set('!space:hs', [{ roomId: '!a:hs' }]);
  const adapter = new MatrixSpaceAdapter(stub.transport);
  const dispose = adapter.subscribeSpaceEvents('!space:hs', () => undefined);
  await new Promise((r) => setImmediate(r));
  assert.equal(stub.subs.get('!space:hs').length, 1);
  dispose();
  assert.equal(stub.subs.get('!space:hs').length, 0);
});

test('space-adapter: subscribeSpaceEvents throws on empty spaceId', () => {
  const stub = makeStubTransport();
  const adapter = new MatrixSpaceAdapter(stub.transport);
  assert.throws(
    () => adapter.subscribeSpaceEvents('', () => undefined),
    /spaceId is required/,
  );
  assert.throws(
    () => adapter.subscribeSpaceEvents('!space:hs', undefined),
    /handler must be a function/,
  );
});

// ─── adapter + config integration ──────────────────────────────────────────

test('space-adapter: empty config keeps Space surface opt-in (defaults to disabled)', async () => {
  // This locks the §1 boundary: connector-level config without a `spaces`
  // block does NOT auto-enable the adapter. The transport will simply not
  // be wired unless `config.spaces.enabled === true`.
  const { buildConfig } = await import('../lib/config.js');
  const cfg = buildConfig({
    homeserverUrl: 'http://hs',
    userId: '@bot:hs',
    accessToken: 'tok',
    deviceId: 'dev',
    agoraServerUrl: 'http://agora',
    agoraApiToken: 'agora-tok',
  });
  assert.equal(cfg.spaces, undefined, 'spaces config is optional and absent by default');
});

test('config preserves a single-instance security boundary and local speech settings', async () => {
  const { buildConfig } = await import('../lib/config.js');
  const cfg = buildConfig({
    homeserverUrl: 'http://hs', userId: '@life-bot:hs', accessToken: 'tok', deviceId: 'dev',
    agoraServerUrl: 'http://agora', agoraApiToken: 'agora-tok',
    securityBoundary: {
      domainRef: 'domain:life', boundaryKind: 'personal-office', rootSpaceId: '!life:hs',
      requireTopLevelRoot: true,
    },
    speech: { enabled: true, provider: 'windows-sapi', voiceName: 'Microsoft Huihui', rate: 1 },
  });
  assert.equal(cfg.securityBoundary?.domainRef, 'domain:life');
  assert.equal(cfg.speech?.provider, 'windows-sapi');
});
