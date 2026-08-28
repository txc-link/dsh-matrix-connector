/**
 * matrix-client unit tests.
 *
 * RED-first: each case asserts a behaviour the wrapper promises.
 * The transport is a fresh stub per case.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MatrixClient } from '../lib/matrix-client.js';

function makeTransport(overrides = {}) {
  const calls = { send: [], edit: [], upload: [], startSync: 0, stopSync: 0 };
  const transport = {
    sendRoomMessage: async (msg) => {
      calls.send.push(msg);
      return { eventId: `evt_${calls.send.length}`, roomId: msg.roomId };
    },
    editRoomMessage: async (roomId, eventId, replacement) => {
      calls.edit.push({ roomId, eventId, replacement });
      return { eventId: `${eventId}_edited`, roomId, replaced: true };
    },
    uploadBytes: async (filename, contentType, bytes) => {
      calls.upload.push({ filename, contentType, size: bytes.length });
      return { mxcUri: `mxc://homeserver/${calls.upload.length}`, sizeBytes: bytes.length };
    },
    startSync: () => { calls.startSync += 1; },
    stopSync: async () => { calls.stopSync += 1; },
    ...overrides,
  };
  return { transport, calls };
}

test('matrix-client: sendText with html body sets formattedBody and format', async () => {
  const { transport, calls } = makeTransport();
  const client = new MatrixClient(transport);
  const receipt = await client.sendText('!room:hs', 'hello', { html: '<b>hello</b>' });
  assert.equal(receipt.eventId, 'evt_1');
  assert.equal(calls.send.length, 1);
  assert.equal(calls.send[0].body, 'hello');
  assert.equal(calls.send[0].formattedBody, '<b>hello</b>');
  assert.equal(calls.send[0].format, 'org.matrix.custom.html');
  assert.equal(calls.send[0].msgType, 'm.text');
});

test('matrix-client: sendText without html omits formattedBody and format', async () => {
  const { transport, calls } = makeTransport();
  const client = new MatrixClient(transport);
  await client.sendText('!room:hs', 'plain');
  assert.equal(calls.send[0].formattedBody, undefined);
  assert.equal(calls.send[0].format, undefined);
});

test('matrix-client: edit preserves formatting when html provided', async () => {
  const { transport, calls } = makeTransport();
  const client = new MatrixClient(transport);
  const receipt = await client.edit('!room:hs', 'evt_42', 'new body', { html: '<i>new body</i>' });
  assert.equal(receipt.eventId, 'evt_42_edited');
  assert.equal(calls.edit[0].eventId, 'evt_42');
  assert.equal(calls.edit[0].replacement.formattedBody, '<i>new body</i>');
});

test('matrix-client: uploadMxc returns mxc uri and size', async () => {
  const { transport, calls } = makeTransport();
  const client = new MatrixClient(transport);
  const bytes = new Uint8Array([0x01, 0x02, 0x03]);
  const out = await client.uploadMxc('file.bin', 'application/octet-stream', bytes);
  assert.match(out.mxcUri, /^mxc:\/\/homeserver\//);
  assert.equal(out.sizeBytes, 3);
  assert.equal(calls.upload[0].filename, 'file.bin');
});

test('matrix-client: startSync / stopSync delegate to transport', async () => {
  const { transport, calls } = makeTransport();
  const client = new MatrixClient(transport);
  client.startSync();
  await client.stopSync();
  assert.equal(calls.startSync, 1);
  assert.equal(calls.stopSync, 1);
});