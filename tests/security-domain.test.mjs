import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SecurityDomainBoundary } from '../lib/security-domain.js';

const config = {
  domainRef: 'domain:life',
  boundaryKind: 'personal-office',
  rootSpaceId: '!life:hs',
  requireTopLevelRoot: true,
  allowedRoomIds: ['!schedule:hs'],
};

test('security boundary binds one connector instance to one domain', () => {
  const boundary = new SecurityDomainBoundary(config);
  assert.equal(boundary.domainRef, 'domain:life');
  assert.equal(boundary.authorizeRoomProjection('domain:life', '!life:hs').allowed, true);
  assert.equal(boundary.authorizeRoomProjection('domain:life', '!schedule:hs').allowed, true);
});

test('security boundary denies cross-domain projection even when the room is known', () => {
  const boundary = new SecurityDomainBoundary(config);
  const result = boundary.authorizeRoomProjection('domain:company', '!schedule:hs');
  assert.deepEqual(result, { allowed: false, reason: 'source_domain_mismatch' });
});

test('security boundary denies unregistered rooms and can bind discovered children', () => {
  const boundary = new SecurityDomainBoundary(config);
  assert.equal(boundary.authorizeRoomProjection('domain:life', '!unknown:hs').reason, 'room_outside_boundary');
  boundary.bindChildRoom('!journal:hs', '!life:hs');
  assert.equal(boundary.authorizeRoomProjection('domain:life', '!journal:hs').allowed, true);
  assert.throws(() => boundary.bindChildRoom('!bad:hs', '!company:hs'), /root Space mismatch/);
});

test('protected personal roots must be top-level and cannot declare a company parent', () => {
  assert.throws(() => new SecurityDomainBoundary({ ...config, parentSpaceId: '!company:hs' }), /top-level/);
  const boundary = new SecurityDomainBoundary(config);
  assert.deepEqual(boundary.verifyRootParents([]), { allowed: true });
  assert.deepEqual(boundary.verifyRootParents(['!company:hs']), {
    allowed: false,
    reason: 'root_space_has_parent',
  });
});

test('company and personal roots cannot share the same bot identity in strict production validation', () => {
  assert.throws(() => SecurityDomainBoundary.validateDeployment([
    { connectorId: 'company', userId: '@bridge:hs', ...config, domainRef: 'domain:company', boundaryKind: 'company', rootSpaceId: '!company:hs' },
    { connectorId: 'life', userId: '@bridge:hs', ...config },
  ]), /dedicated bot identity/);
});

