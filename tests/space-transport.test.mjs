import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MatrixJsSdkSpaceTransport } from '../lib/transport/space-transport.js';

function matrixEvent({ type = 'm.space.child', stateKey = '', content = {} } = {}) {
  return {
    getType: () => type,
    getStateKey: () => stateKey,
    getContent: () => content,
    getSender: () => '@root:hs',
    getId: () => '$event',
  };
}

test('space transport listens for child state on Room.currentState', () => {
  const currentState = new EventEmitter();
  currentState.getStateEvents = () => [];
  const room = new EventEmitter();
  room.roomId = '!company:hs';
  room.currentState = currentState;
  const sdk = { getRoom: (roomId) => roomId === room.roomId ? room : undefined };
  const transport = new MatrixJsSdkSpaceTransport({
    matrixJsSdkTransport: { getSdk: () => sdk },
  });
  const received = [];

  const dispose = transport.subscribeSpaceEvents(room.roomId, [], (event) => received.push(event));
  currentState.emit(
    'RoomState.events',
    matrixEvent({ stateKey: '!new-child:hs', content: { via: ['hs'], suggested: true } }),
    currentState,
    null,
  );

  assert.deepEqual(received, [{
    kind: 'child-added',
    spaceId: '!company:hs',
    child: { roomId: '!new-child:hs', via: ['hs'], suggested: true },
  }]);
  dispose();
  assert.equal(currentState.listenerCount('RoomState.events'), 0);
});

test('space transport treats empty replacement state as child removal', () => {
  const currentState = new EventEmitter();
  currentState.getStateEvents = () => [];
  const room = new EventEmitter();
  room.roomId = '!company:hs';
  room.currentState = currentState;
  const sdk = { getRoom: (roomId) => roomId === room.roomId ? room : undefined };
  const transport = new MatrixJsSdkSpaceTransport({
    matrixJsSdkTransport: { getSdk: () => sdk },
  });
  const received = [];

  const dispose = transport.subscribeSpaceEvents(
    room.roomId,
    ['!old-child:hs'],
    (event) => received.push(event),
  );
  currentState.emit(
    'RoomState.events',
    matrixEvent({ stateKey: '!old-child:hs', content: {} }),
    currentState,
    matrixEvent({ stateKey: '!old-child:hs', content: { via: ['hs'] } }),
  );

  assert.deepEqual(received, [{
    kind: 'child-removed',
    spaceId: '!company:hs',
    childRoomId: '!old-child:hs',
  }]);
  dispose();
});
