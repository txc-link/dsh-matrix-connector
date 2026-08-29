/**
 * matrix-transport.test.mjs — RED-first unit tests for MatrixJsSdkTransport.
 *
 * matrix-js-sdk is intentionally NOT mocked at module level — instead we
 * validate the transport's *interface contract* by verifying it forwards
 * the right calls. For deep sdk semantics, see smoke-real-homeserver.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MatrixJsSdkTransport } from '../lib/transport/matrix-js-sdk.js';

test('matrix-js-sdk-transport: connect initializes in-memory Rust crypto before sync', async () => {
  const calls = { start: [], crypto: [], stop: 0, listeners: [], order: [] };
  const sdk = {
    startClient: async (options) => { calls.start.push(options); calls.order.push('start'); },
    initRustCrypto: async (options) => { calls.crypto.push(options); calls.order.push('crypto'); },
    stopClient: async () => { calls.stop += 1; },
    on: (event) => { calls.listeners.push(event); },
  };
  const transport = new MatrixJsSdkTransport(
    {
      homeserverUrl: 'http://homeserver.test',
      accessToken: 'syt_dummy',
      userId: '@test:agent-hub.local',
      deviceId: 'DEVICE',
    },
    { createClient: () => sdk },
  );

  await transport.connect();

  assert.equal(transport.isConnected(), true);
  assert.deepEqual(calls.start, [{ initialSyncLimit: 0 }]);
  assert.deepEqual(calls.crypto, [{ useIndexedDB: false }]);
  assert.deepEqual(calls.order, ['crypto', 'start']);
  assert.ok(calls.listeners.includes('Room.myMembership'));

  await transport.stopSync();
  assert.equal(calls.stop, 1);
  assert.equal(transport.isConnected(), false);
});

test('matrix-js-sdk-transport: not-connected methods throw clear errors', async () => {
  const transport = new MatrixJsSdkTransport({
    homeserverUrl: 'http://localhost:0',
    accessToken: 'syt_dummy',
    userId: '@test:agent-hub.local',
  });
  await assert.rejects(
    () => transport.sendRoomMessage({ roomId: '!r:hs', senderMxid: '', body: 'hi' }),
    /not connected/i,
  );
  await assert.rejects(
    () => transport.createRoom({ name: 'x' }),
    /not connected/i,
  );
  await assert.rejects(
    () => transport.editRoomMessage('!r:hs', '$evt', { roomId: '!r:hs', senderMxid: '', body: 'edit' }),
    /not connected/i,
  );
  await assert.rejects(
    () => transport.uploadBytes('f.txt', 'text/plain', new Uint8Array([1])),
    /not connected/i,
  );
});

test('matrix-js-sdk-transport: surface createRoom result maps to roomId', () => {
  // Pure mapper — no I/O.
  const transport = new MatrixJsSdkTransport({
    homeserverUrl: 'http://localhost:0',
    accessToken: 'syt_dummy',
    userId: '@test:agent-hub.local',
  });
  // simulate SDK response shape
  const fakeResp = { room_id: '!Abc123:agent-hub.local' };
  // @ts-ignore — access private mapper
  const mapped = transport.toCreateRoomReceipt(fakeResp);
  assert.equal(mapped.roomId, '!Abc123:agent-hub.local');
});

test('matrix-js-sdk-transport: surface sendEvent result maps to eventId', () => {
  const transport = new MatrixJsSdkTransport({
    homeserverUrl: 'http://localhost:0',
    accessToken: 'syt_dummy',
    userId: '@test:agent-hub.local',
  });
  // @ts-ignore
  const mapped = transport.toSendReceipt('!r:hs', { event_id: '$evt_xyz' });
  assert.deepEqual(mapped, { eventId: '$evt_xyz', roomId: '!r:hs' });
});

test('matrix-js-sdk-transport: edit m.room.message body uses m.replace relation', () => {
  const transport = new MatrixJsSdkTransport({
    homeserverUrl: 'http://localhost:0',
    accessToken: 'syt_dummy',
    userId: '@test:agent-hub.local',
  });
  const content = transport.buildEditContent('$evt_orig', { roomId: '!r:hs', senderMxid: '', body: 'edited' });
  assert.equal(content.body, 'edited');
  assert.equal(content.msgtype, 'm.text');
  assert.deepEqual(content['m.relates_to'], {
    rel_type: 'm.replace',
    event_id: '$evt_orig',
  });
  assert.equal(content['m.new_content'].body, 'edited');
});

test('matrix-js-sdk-transport: send message without html omits formatted_body', () => {
  const transport = new MatrixJsSdkTransport({
    homeserverUrl: 'http://localhost:0',
    accessToken: 'syt_dummy',
    userId: '@test:agent-hub.local',
  });
  const content = transport.buildSendContent({ roomId: '!r:hs', senderMxid: '', body: 'plain' });
  assert.equal(content.body, 'plain');
  assert.equal(content.msgtype, 'm.text');
  assert.equal(content.formatted_body, undefined);
  assert.equal(content.format, undefined);
});

test('matrix-js-sdk-transport: send message with html includes formatted_body', () => {
  const transport = new MatrixJsSdkTransport({
    homeserverUrl: 'http://localhost:0',
    accessToken: 'syt_dummy',
    userId: '@test:agent-hub.local',
  });
  const content = transport.buildSendContent({
    roomId: '!r:hs', senderMxid: '', body: 'hi', formattedBody: '<b>hi</b>', format: 'org.matrix.custom.html',
  });
  assert.equal(content.body, 'hi');
  assert.equal(content.formatted_body, '<b>hi</b>');
  assert.equal(content.format, 'org.matrix.custom.html');
});
