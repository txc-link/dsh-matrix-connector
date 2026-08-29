/**
 * room-provisioner.test.mjs — RED-first integration tests for provisionTaskRoom.
 *
 * Stubs agora.getTask + client.createRoom; verifies the provisioner wires
 * task title → room name → createRoom.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { provisionTaskRoom } from '../lib/room-provisioner.js';

function stubClient(roomId = '!abc:agent-hub.local') {
  const calls = [];
  return {
    createRoom: async (opts) => {
      calls.push(opts);
      return { roomId };
    },
    calls,
  };
}

function stubAgora(task) {
  return {
    getTask: async (taskId) => {
      if (!task) throw new Error(`task not found: ${taskId}`);
      return task;
    },
  };
}

test('room-provisioner: creates room named after task title', async () => {
  const client = stubClient();
  const agora = stubAgora({ id: 'T-7', title: 'Ship matrix bridge' });
  const result = await provisionTaskRoom({ client, agora, taskId: 'T-7' });
  assert.equal(result.roomId, '!abc:agent-hub.local');
  assert.equal(result.roomName, '[T-7] Ship matrix bridge');
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].name, '[T-7] Ship matrix bridge');
});

test('room-provisioner: propagates task-not-found error', async () => {
  const client = stubClient();
  const agora = stubAgora(null);
  await assert.rejects(
    () => provisionTaskRoom({ client, agora, taskId: 'T-missing' }),
    /task not found: T-missing/,
  );
  assert.equal(client.calls.length, 0, 'no createRoom on failure');
});

test('room-provisioner: room name is matrix-safe (≤255, no control chars)', async () => {
  const client = stubClient();
  const agora = stubAgora({ id: 'T-8', title: `long\u0000title ${'x'.repeat(300)}` });
  const result = await provisionTaskRoom({ client, agora, taskId: 'T-8' });
  assert.ok(result.roomName.length <= 255);
  assert.ok(!result.roomName.includes('\u0000'));
});
