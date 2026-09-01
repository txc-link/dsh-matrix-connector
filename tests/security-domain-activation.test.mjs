import test from 'node:test';
import assert from 'node:assert/strict';
import { SecurityDomainBoundary } from '../lib/security-domain.js';

const item = (domainRef, rootSpaceId, userId = `@${domainRef}:example.org`) => ({ domainRef, boundaryKind: domainRef === 'company' ? 'company' : domainRef, rootSpaceId, connectorId: `${domainRef}-connector`, userId });
test('security activation is gated until handshake and fault recovery evidence exist', () => {
  const plan = { company: item('company', '!company:example.org'), life: item('life', '!life:example.org'), health: item('health', '!health:example.org'), companion: item('companion', '!companion:example.org'), verified: { handshake: false, faultRecovery: true } };
  assert.throws(() => SecurityDomainBoundary.validateActivationPlan(plan), /verified handshake/);
  plan.verified.handshake = true;
  assert.doesNotThrow(() => SecurityDomainBoundary.validateActivationPlan(plan));
});
