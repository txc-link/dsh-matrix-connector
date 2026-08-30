import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isMatrixSenderAllowed } from '../lib/sender-authorization.js';

test('allowFrom accepts wildcard and exact comma-separated Matrix IDs', () => {
  assert.equal(isMatrixSenderAllowed('@alice:example.org', '*'), true);
  assert.equal(
    isMatrixSenderAllowed('@bob:example.org', ' @alice:example.org, @bob:example.org '),
    true,
  );
  assert.equal(isMatrixSenderAllowed('@mallory:example.org', '@alice:example.org'), false);
});

test('allowFrom defaults to wildcard but an explicitly empty policy fails closed', () => {
  assert.equal(isMatrixSenderAllowed('@alice:example.org', undefined), true);
  assert.equal(isMatrixSenderAllowed('@alice:example.org', '   '), false);
});
