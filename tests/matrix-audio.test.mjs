import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MatrixClient } from '../lib/matrix-client.js';
import { MatrixJsSdkTransport } from '../lib/transport/matrix-js-sdk.js';

test('MatrixClient uploads bytes then sends a portable m.audio message', async () => {
  const calls = [];
  const transport = {
    uploadBytes: async (filename, contentType, bytes) => {
      calls.push({ kind: 'upload', filename, contentType, size: bytes.length });
      return { mxcUri: 'mxc://hs/voice', sizeBytes: bytes.length };
    },
    sendRoomMessage: async (message) => {
      calls.push({ kind: 'send', message });
      return { eventId: '$voice', roomId: message.roomId };
    },
    editRoomMessage: async () => { throw new Error('unused'); },
    startSync() {},
    async stopSync() {},
  };
  const client = new MatrixClient(transport);
  const result = await client.sendAudio('!personal:hs', {
    filename: 'care.wav',
    body: '晚安语音',
    contentType: 'audio/wav',
    bytes: new Uint8Array([1, 2, 3, 4]),
    durationMs: 1234,
    voice: true,
  });
  assert.equal(result.eventId, '$voice');
  assert.equal(calls[0].kind, 'upload');
  assert.equal(calls[1].message.msgType, 'm.audio');
  assert.equal(calls[1].message.url, 'mxc://hs/voice');
  assert.deepEqual(calls[1].message.info, { duration: 1234, mimetype: 'audio/wav', size: 4 });
  assert.deepEqual(calls[1].message.voice, {});
});

test('matrix transport maps audio metadata to Matrix m.audio content', () => {
  const transport = new MatrixJsSdkTransport({
    homeserverUrl: 'http://hs', accessToken: 'tok', userId: '@bot:hs',
  });
  const content = transport.buildSendContent({
    roomId: '!r:hs', senderMxid: '', body: 'voice.wav', msgType: 'm.audio',
    url: 'mxc://hs/a', info: { duration: 700, mimetype: 'audio/wav', size: 44 }, voice: {},
  });
  assert.deepEqual(content, {
    msgtype: 'm.audio', body: 'voice.wav', url: 'mxc://hs/a',
    info: { duration: 700, mimetype: 'audio/wav', size: 44 },
    'org.matrix.msc3245.voice': {},
  });
});

