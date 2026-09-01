import test from 'node:test';
import assert from 'node:assert/strict';
import { SecurityDomainBoundary } from '../lib/security-domain.js';

const item = (domainRef, rootSpaceId, userId = `@${domainRef}:example.org`) => ({ domainRef, boundaryKind: domainRef === 'company' ? 'company' : domainRef, rootSpaceId, connectorId: `${domainRef}-connector`, userId, e2ee: 'disabled' });
test('security activation is gated until handshake and fault recovery evidence exist', () => {
  const plan = { company: item('company', '!company:example.org'), life: item('life', '!life:example.org'), health: item('health', '!health:example.org'), companion: item('companion', '!companion:example.org'), verified: { handshakeReceipt: '', faultRecoveryReceipt: 'fault-run-1' } };
  assert.throws(() => SecurityDomainBoundary.validateActivationPlan(plan), /verifiable handshake/);
  plan.verified.handshakeReceipt = 'handshake-node-mac-2026-09-01';
  assert.doesNotThrow(() => SecurityDomainBoundary.validateActivationPlan(plan));
});
