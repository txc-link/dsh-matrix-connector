/**
 * smoke-real-homeserver.mjs — real homeserver E2E smoke for MatrixJsSdkTransport.
 *
 * Skipped unless AGORA_SMOKE_HOMESERVER_URL + AGORA_SMOKE_ACCESS_TOKEN + AGORA_SMOKE_USER_ID
 * are set. Default runs in CI without these env vars → test is no-op (passes).
 *
 * Manual run from worktree:
 *   AGORA_SMOKE_HOMESERVER_URL=http://localhost:8008 \
 *   AGORA_SMOKE_ACCESS_TOKEN=<token> \
 *   AGORA_SMOKE_USER_ID=@dsh-bridge-node-a:agent-hub.local \
 *   node tests/smoke-real-homeserver.mjs
 *
 * Validates end-to-end:
 *   - connect() succeeds (initial /sync completes)
 *   - createRoom() returns a real roomId
 *   - sendRoomMessage() returns a real eventId
 *   - roomId/eventId are well-formed matrix IDs
 *   - transport startSync + stopSync lifecycle works
 *   - joinedMembers returns our user_id
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const URL = process.env.AGORA_SMOKE_HOMESERVER_URL;
const TOKEN = process.env.AGORA_SMOKE_ACCESS_TOKEN;
const USER = process.env.AGORA_SMOKE_USER_ID;

const hasEnv = !!(URL && TOKEN && USER);

const { MatrixJsSdkTransport } = hasEnv
  ? await import('../lib/transport/matrix-js-sdk.js')
  : { MatrixJsSdkTransport: null };

test('smoke: connect to real homeserver and create+send', { skip: !hasEnv && 'set AGORA_SMOKE_* env vars' }, async () => {
  const transport = new MatrixJsSdkTransport({
    homeserverUrl: URL,
    accessToken: TOKEN,
    userId: USER,
  });
  await transport.connect();
  assert.equal(transport.isConnected(), true, 'should be connected after connect()');

  const room = await transport.createRoom({
    name: 'agora-smoke-' + Date.now(),
    topic: 'matrix-connector T-1 smoke',
    visibility: 'private',
    preset: 'private_chat',
  });
  assert.match(room.roomId, /^![A-Za-z0-9]+:agent-hub\.local$/, 'roomId should be well-formed');

  const msg = await transport.sendRoomMessage({
    roomId: room.roomId,
    senderMxid: USER,
    body: 'hello from agora matrix-connector T-1 smoke',
    msgType: 'm.text',
  });
  assert.match(msg.eventId, /^\$[A-Za-z0-9_-]+$/, 'eventId should be well-formed');
  assert.equal(msg.roomId, room.roomId);

  const members = await transport.joinedMembers(room.roomId);
  assert.ok(Array.isArray(members), 'joinedMembers should return array');
  assert.ok(members.includes(USER), 'our user should be in the room');

  await transport.stopSync();
  assert.equal(transport.isConnected(), false, 'should be disconnected after stopSync()');
});