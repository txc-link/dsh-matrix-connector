import assert from 'node:assert/strict';
import test from 'node:test';
import { CollabTurnController, isLikelyAgentMxid, parseRoleMentions } from '../lib/collab-turn-controller.js';

test('parses explicit role mentions without Matrix ids', () => {
  assert.deepEqual(parseRoleMentions('请 @researcher 和 @writer 汇总'), ['researcher', 'writer']);
});

test('requires explicit targets for agents and bounds turns', () => {
  const controller = new CollabTurnController({ maxRounds: 2, cooldownMs: 0 });
  assert.equal(controller.decide({ roomId: '!r', senderMxid: '@dsh-a:example.org', body: '我完成了', actorKind: 'agent', eventId: 'e1' }).status, 'ignore');
  assert.equal(controller.decide({ roomId: '!r', senderMxid: '@human:example.org', body: '@researcher 继续验证', actorKind: 'human', eventId: 'e2' }).status, 'wake');
  assert.equal(controller.decide({ roomId: '!r', senderMxid: '@dsh-a:example.org', body: '@writer 请接手', actorKind: 'agent', eventId: 'e3' }).status, 'wake');
  assert.equal(controller.decide({ roomId: '!r', senderMxid: '@dsh-a:example.org', body: '@writer 再说一次', actorKind: 'agent', eventId: 'e4' }).status, 'round_limit');
});

test('classifies the deployed bridge bot shape', () => {
  assert.equal(isLikelyAgentMxid('@dsh-bridge-node-a:agent-hub.local'), true);
  assert.equal(isLikelyAgentMxid('@alice:agent-hub.local'), false);
});
