import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GovernedVoiceDelivery } from '../lib/governed-voice.js';
import { SecurityDomainBoundary } from '../lib/security-domain.js';

function makeSubject(overrides = {}) {
  const calls = { authorize: [], risk: [], synthesize: [], send: [] };
  const boundary = new SecurityDomainBoundary({
    domainRef: 'domain:companion', boundaryKind: 'companion',
    rootSpaceId: '!companion:hs', allowedRoomIds: ['!private:hs'],
  });
  const service = new GovernedVoiceDelivery({
    boundary,
    agora: {
      authorizeInformationProjection: async (input) => {
        calls.authorize.push(input);
        return { allowed: true, reason: 'same-domain', grant_id: null };
      },
      assessActionRisk: async (input) => {
        calls.risk.push(input);
        return { id: 'risk-1', decision: 'allow', risk_level: 'low', reasons: [] };
      },
      ...overrides.agora,
    },
    synthesizer: {
      synthesize: async (text) => {
        calls.synthesize.push(text);
        return { bytes: new Uint8Array([1, 2]), contentType: 'audio/wav', filename: 'care.wav', durationMs: 800 };
      },
      ...overrides.synthesizer,
    },
    matrix: {
      sendAudio: async (roomId, input) => {
        calls.send.push({ roomId, input });
        return { roomId, eventId: '$voice' };
      },
      ...overrides.matrix,
    },
  });
  return { service, calls };
}

const request = {
  roomId: '!private:hs',
  text: '记得早点休息。',
  resourceRef: 'memory:companion/check-in-1',
  sourceDomain: 'domain:companion',
  actorRef: 'relationship:companion-1',
  subjectRef: 'person:owner',
  purpose: 'proactive-care',
};

test('governed voice authorizes information and action before local synthesis/send', async () => {
  const { service, calls } = makeSubject();
  const receipt = await service.deliver(request);
  assert.equal(receipt.eventId, '$voice');
  assert.equal(calls.authorize.length, 1);
  assert.equal(calls.authorize[0].target_domain, 'domain:companion');
  assert.equal(calls.risk[0].action_kind, 'communicate');
  assert.deepEqual(calls.synthesize, ['记得早点休息。']);
  assert.equal(calls.send[0].input.voice, true);
});

test('governed voice denies cross-domain room projection before Core or TTS sees text', async () => {
  const { service, calls } = makeSubject();
  await assert.rejects(() => service.deliver({ ...request, sourceDomain: 'domain:company' }), /source_domain_mismatch/);
  assert.equal(calls.authorize.length, 0);
  assert.equal(calls.synthesize.length, 0);
});

test('governed voice stops when information authorization is denied', async () => {
  const { service, calls } = makeSubject({
    agora: { authorizeInformationProjection: async () => ({ allowed: false, reason: 'consent required', grant_id: null }) },
  });
  await assert.rejects(() => service.deliver(request), /consent required/);
  assert.equal(calls.risk.length, 0);
  assert.equal(calls.synthesize.length, 0);
});

test('governed voice stops on Human Gate and does not synthesize sensitive text', async () => {
  const { service, calls } = makeSubject({
    agora: { assessActionRisk: async () => ({ id: 'risk-2', decision: 'require_human_gate', risk_level: 'high', reasons: ['third-party effect'] }) },
  });
  await assert.rejects(() => service.deliver(request), /Human Gate/);
  assert.equal(calls.synthesize.length, 0);
});

