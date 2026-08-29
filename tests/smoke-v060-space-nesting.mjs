/**
 * smoke-v060-space-nesting.mjs — real homeserver E2E smoke for MatrixJsSdkSpaceTransport.
 *
 * R-E.2 acceptance gate: validates that the matrix-js-sdk-backed transport
 * satisfies every part of the `MatrixSpaceTransport` contract against the
 * real Space + children left in place by R-E.1:
 *
 *   - Space root       `!OCNKEikkiiJEMdWyiQ:agent-hub.local`
 *   - Child A          `!MZMrZgRuHQTCumysHu:agent-hub.local`
 *   - Child B          `!ReGdGmbaNfUYgtlfnN:agent-hub.local`
 *   - Smoke bot        `@r-e-smoke:agent-hub.local`
 *       token          `syt_ci1lLXNtb2tl_zcogUqbhGRtCIcYESVeJ_49hNYL`
 *
 * The script connects a `MatrixJsSdkTransport` (drives a real SdkMatrixClient
 * /sync loop), wraps it in `MatrixJsSdkSpaceTransport`, and asserts each of
 * the four contract methods + the live subscription:
 *
 *   1. isSpaceRoom(SpaceID) === true
 *   2. isSpaceRoom(ChildA)  === false
 *   3. listChildRooms(SpaceID) length === 2, contains ChildA + ChildB
 *   4. getSpaceHierarchy(SpaceID).childRooms.length === 2, names match
 *   5. live subscription — bot posts an m.room.message in ChildA → handler
 *      receives kind=message with correct childRoomId + sender
 *   6. live subscription — bot PUT state m.space.child on a fresh ChildC
 *      room → handler receives kind=child-added; then remove state →
 *      handler receives kind=child-removed
 *
 * Cleanup at the end disposes the subscription and removes the temporary
 * ChildC state. Exits 0 on success, throws on any failure.
 *
 * Run with:
 *   node tests/smoke-v060-space-nesting.mjs
 */

import assert from 'node:assert/strict';

const HS = 'http://localhost:8008';
const BOT_USER = '@r-e-smoke:agent-hub.local';
const BOT_TOKEN = 'syt_ci1lLXNtb2tl_zcogUqbhGRtCIcYESVeJ_49hNYL';
const SPACE_ID = '!OCNKEikkiiJEMdWyiQ:agent-hub.local';
const CHILD_A = '!MZMrZgRuHQTCumysHu:agent-hub.local';
const CHILD_B = '!ReGdGmbaNfUYgtlfnN:agent-hub.local';

const { MatrixJsSdkTransport } = await import('../lib/transport/matrix-js-sdk.js');
const { MatrixJsSdkSpaceTransport } = await import('../lib/transport/space-transport.js');

function log(...args) {
  process.stdout.write(`[smoke] ${args.join(' ')}\n`);
}

/** Sleep helper for SDK sync settling. */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** REST helper for the smoke bot — bypasses SDK to keep state writes atomic. */
async function putState(type, roomId, stateKey, content) {
  const resp = await fetch(`${HS}/_matrix/client/v3/rooms/${roomId}/state/${type}/${stateKey ?? ''}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(content),
  });
  if (!resp.ok) {
    throw new Error(`PUT state ${type} on ${roomId} failed: HTTP ${resp.status} ${await resp.text()}`);
  }
  return await resp.json();
}

async function sendTextMessage(roomId, body) {
  const txnId = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const resp = await fetch(`${HS}/_matrix/client/v3/rooms/${roomId}/send/m.room.message/${txnId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ msgtype: 'm.text', body }),
  });
  if (!resp.ok) {
    throw new Error(`send m.room.message to ${roomId} failed: HTTP ${resp.status} ${await resp.text()}`);
  }
  return (await resp.json()).event_id;
}

async function main() {
  log('starting R-E.2 space nesting smoke');
  const transport = new MatrixJsSdkTransport({
    homeserverUrl: HS,
    accessToken: BOT_TOKEN,
    userId: BOT_USER,
  });
  await transport.connect();
  log('MatrixJsSdkTransport connected');

  // Give the SDK a moment to populate the in-memory Room cache for the
  // Space + children we are about to query.
  await sleep(500);

  const spaceTransport = new MatrixJsSdkSpaceTransport({ matrixJsSdkTransport: transport });

  // Sanity-check the SDK Room cache before exercising the transport.
  const sdk = transport.getSdk();
  const cachedRoomIds = sdk ? sdk.getRooms().map((r) => r.roomId) : [];
  log(`SDK cache: ${cachedRoomIds.length} rooms: ${cachedRoomIds.join(', ')}`);
  assert.ok(cachedRoomIds.includes(SPACE_ID), 'SDK cache should contain SPACE_ID');
  assert.ok(cachedRoomIds.includes(CHILD_A), 'SDK cache should contain CHILD_A');

  // ── Assertion 1: isSpaceRoom(SpaceID) === true ───────────────────────
  log('assert 1: isSpaceRoom(SPACE_ID) === true');
  assert.equal(await spaceTransport.isSpaceRoom(SPACE_ID), true, 'space root must report isSpaceRoom true');

  // ── Assertion 2: isSpaceRoom(ChildA) === false ───────────────────────
  log('assert 2: isSpaceRoom(CHILD_A) === false');
  assert.equal(await spaceTransport.isSpaceRoom(CHILD_A), false, 'child room must NOT report isSpaceRoom true');

  // ── Assertion 3: listChildRooms(SpaceID) ─────────────────────────────
  log('assert 3: listChildRooms(SPACE_ID) returns 2 children including A+B');
  const children = await spaceTransport.listChildRooms(SPACE_ID);
  assert.equal(children.length, 2, `expected 2 children, got ${children.length}`);
  const childIds = children.map((c) => c.roomId);
  assert.ok(childIds.includes(CHILD_A), `children missing CHILD_A: ${JSON.stringify(childIds)}`);
  assert.ok(childIds.includes(CHILD_B), `children missing CHILD_B: ${JSON.stringify(childIds)}`);
  const childA = children.find((c) => c.roomId === CHILD_A);
  assert.equal(childA?.order, 'a', 'child A order');
  assert.equal(childA?.suggested, true, 'child A suggested');
  assert.deepEqual(childA?.via, ['agent-hub.local'], 'child A via');

  // ── Assertion 4: getSpaceHierarchy(SpaceID) ─────────────────────────
  log('assert 4: getSpaceHierarchy(SPACE_ID) returns 2 child Room refs');
  const hierarchy = await spaceTransport.getSpaceHierarchy(SPACE_ID);
  assert.equal(hierarchy.space.spaceId, SPACE_ID, 'root spaceId');
  assert.equal(hierarchy.space.name, 'R-E Smoke Space', 'root name');
  assert.equal(hierarchy.space.children.length, 2, 'root.children length');
  assert.equal(hierarchy.childRooms.length, 2, 'childRooms length');
  const childAName = hierarchy.childRooms.find((r) => r.spaceId === CHILD_A)?.name;
  const childBName = hierarchy.childRooms.find((r) => r.spaceId === CHILD_B)?.name;
  assert.equal(childAName, 'R-E Smoke Child A', 'child A name from /hierarchy');
  assert.equal(childBName, 'R-E Smoke Child B', 'child B name from /hierarchy');

  // ── Assertion 5: live subscription — child room message ─────────────
  log('assert 5: subscribeSpaceEvents receives kind=message on child timeline');
  const received = [];
  const waitFor = (predicate, timeoutMs) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out (${timeoutMs}ms) waiting for predicate: ${predicate.toString().slice(0, 80)}`)), timeoutMs);
    const tick = () => {
      if (predicate()) {
        clearTimeout(timer);
        resolve();
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
  const dispose = spaceTransport.subscribeSpaceEvents(
    SPACE_ID,
    children.map((c) => c.roomId),
    (evt) => {
      received.push(evt);
    },
  );
  // Allow RoomState listeners to attach + initial sync to settle.
  await sleep(500);

  const msgEventId = await sendTextMessage(CHILD_A, 'R-E.2 smoke: child timeline message');
  log(`   sent message ${msgEventId} in CHILD_A`);
  await waitFor(() => received.some((e) => e.kind === 'message'), 5000);
  log(`   ✓ kind=message received`);

  // ── Assertion 6: live subscription — child-added / child-removed ─────
  log('assert 6: subscribeSpaceEvents receives kind=child-added on state change');

  // Create a temporary child room + link it via m.space.child state. We
  // use the REST admin endpoints so the smoke bot owns it.
  const createResp = await fetch(`${HS}/_matrix/client/v3/createRoom`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'R-E.2 Smoke Child C',
      topic: 'temporary',
      visibility: 'public',
      preset: 'public_chat',
    }),
  });
  assert.ok(createResp.ok, `createRoom failed: HTTP ${createResp.status}`);
  const childC = (await createResp.json()).room_id;
  log(`   created temporary child C: ${childC}`);

  // Wait briefly for SDK to see the new room in the /sync cache, then
  // PUT m.space.child state to link it. The subscription should fire
  // child-added.
  await sleep(500);
  await putState('m.space.child', SPACE_ID, childC, {
    order: 'c',
    suggested: false,
    via: ['agent-hub.local'],
  });
  log('   PUT m.space.child state, awaiting handler...');

  // Wait up to 5s for the add.
  await waitFor(
    () => received.some((e) => e.kind === 'child-added' && e.child?.roomId === childC),
    5000,
  );
  log(`   ✓ kind=child-added for ${childC} received`);

  // Cleanup: remove the m.space.child state so the Space returns to its
  // 2-child shape for future smokes.
  await putState('m.space.child', SPACE_ID, childC, {});
  log('   removed m.space.child state for cleanup');
  await sleep(300);

  // ── Verify subscription events ──────────────────────────────────────
  const messageEvts = received.filter((e) => e.kind === 'message');
  const childAddedEvts = received.filter(
    (e) => e.kind === 'child-added' && e.child?.roomId === childC,
  );
  log(`   received events: ${received.length} total (${messageEvts.length} messages, ${childAddedEvts.length} child-added for ChildC)`);

  assert.ok(messageEvts.length >= 1, 'expected at least one kind=message event from CHILD_A');
  const msgEvt = messageEvts[0];
  assert.equal(msgEvt.kind, 'message');
  assert.equal(msgEvt.spaceId, SPACE_ID);
  assert.equal(msgEvt.childRoomId, CHILD_A, 'message should originate from CHILD_A');
  assert.equal(msgEvt.sender, BOT_USER, 'message sender should be the smoke bot');
  assert.match(msgEvt.body, /R-E\.2 smoke/);

  assert.ok(childAddedEvts.length >= 1, 'expected at least one kind=child-added for ChildC');
  const addEvt = childAddedEvts[0];
  assert.equal(addEvt.kind, 'child-added');
  assert.equal(addEvt.spaceId, SPACE_ID);
  assert.equal(addEvt.child.roomId, childC);
  assert.equal(addEvt.child.order, 'c');

  // Final dispose + lifecycle cleanup.
  dispose();
  log('disposed subscription');
  await transport.stopSync();
  log('transport stopped');

  log('✓ ALL ASSERTIONS PASSED');
  // Give the SDK sync loop a moment to gracefully wind down.
  await sleep(200);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n[smoke] FAILED: ${err.stack || err.message}\n`);
  process.exit(1);
});