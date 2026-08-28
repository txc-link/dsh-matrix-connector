#!/usr/bin/env node
/**
 * smoke-v032-room-roster.mjs — verify the room-roster resolver against
 * the live Matrix homeserver, fetching the actual war-room roster
 * and asserting the dsh-bridge-<name> bot user_ids resolve as expected.
 */

import assert from 'node:assert/strict';

class Skipped extends Error {}
function required(name) {
  const value = process.env[name];
  if (!value) throw new Skipped(`missing env ${name}`);
  return value;
}

const HS = required('MATRIX_HOMESERVER_URL');
const TOKEN = required('MATRIX_ACCESS_TOKEN');
const ROOM_ID = required('MATRIX_ROOM_ID');

async function http(path) {
  const r = await fetch(`${HS}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`GET ${path} failed: ${r.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}

const { resolveFromRoster } = await import('../lib/room-roster.js');

console.log('== smoke-v032-room-roster ==');
console.log('homeserver:', HS);
console.log('room:', ROOM_ID);

const res = await http(
  `/_matrix/client/v3/rooms/${encodeURIComponent(ROOM_ID)}/joined_members`,
);
const memberIds = Object.keys(res.joined ?? {});
console.log(`members: ${memberIds.length}`);
for (const id of memberIds) console.log(`  - ${id}`);

const resolved = resolveFromRoster('node-a', memberIds);
console.log(`resolveFromRoster('node-a', roster) = ${resolved}`);

// Sanity: at least one dsh-bridge-<name> bot is present in the room.
const bridgeIds = memberIds.filter((id) => id.startsWith('@dsh-bridge-'));
console.log(`bridge bots in room: ${bridgeIds.length}`);
assert.ok(bridgeIds.length > 0, 'expected at least one dsh-bridge-* bot in the room');

// Resolve by exact suffix.
if (bridgeIds.some((id) => id.includes('node-a'))) {
  const r1 = resolveFromRoster('node-a', memberIds);
  assert.equal(r1, 'node-a');
  console.log('exact-suffix resolution: OK');
}

// Resolve by unique prefix if a unique-prefix bot exists.
for (const id of bridgeIds) {
  const colon = id.indexOf(':');
  const agentId = id.slice('dsh-bridge-'.length + 1, colon);
  if (agentId.length > 4) {
    const prefix = agentId.slice(0, 3);
    const r2 = resolveFromRoster(prefix, memberIds);
    console.log(`prefix='${prefix}' → ${r2}`);
  }
}

console.log('OK smoke-v032-room-roster passed.');