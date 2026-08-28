/**
 * tests/room-roster.test.mjs — RED tests for v0.3.2 room-roster resolver.
 *
 * Each Matrix bot in the war room is a dsh-bridge-<name>:agent-hub.local.
 * The resolver strips the dsh-bridge- prefix and treats the remaining
 * suffix as the agentId that agora central understands.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFromRoster } from '../lib/room-roster.js';

describe('resolveFromRoster', () => {
  it('returns undefined when roster is empty', () => {
    const out = resolveFromRoster('node-a', []);
    assert.equal(out, undefined);
  });

  it('returns the agentId for an exact suffix match', () => {
    const roster = [
      '@dsh-bridge-node-a:agent-hub.local',
      '@dsh-bridge-node-c:agent-hub.local',
    ];
    const out = resolveFromRoster('node-a', roster);
    assert.equal(out, 'node-a');
  });

  it('returns the agentId for a unique suffix prefix', () => {
    const roster = [
      '@dsh-bridge-code-reviewer:agent-hub.local',
      '@dsh-bridge-coder:agent-hub.local',
    ];
    const out = resolveFromRoster('code-rev', roster);
    assert.equal(out, 'code-reviewer');
  });

  it('returns undefined when suffix prefix is ambiguous', () => {
    const roster = [
      '@dsh-bridge-code-reviewer:agent-hub.local',
      '@dsh-bridge-test-reviewer:agent-hub.local',
    ];
    const out = resolveFromRoster('rev', roster);
    assert.equal(out, undefined);
  });

  it('ignores members without a dsh-bridge- prefix', () => {
    const roster = [
      '@alice:agent-hub.local',
      '@dsh-bridge-coder:agent-hub.local',
    ];
    const out = resolveFromRoster('cod', roster);
    assert.equal(out, 'coder');
  });

  it('strips an explicit @ prefix from the candidate', () => {
    const roster = ['@dsh-bridge-coder:agent-hub.local'];
    const out = resolveFromRoster('@coder', roster);
    assert.equal(out, 'coder');
  });

  it('returns undefined when no member starts with the candidate', () => {
    const roster = ['@dsh-bridge-coder:agent-hub.local'];
    const out = resolveFromRoster('xyz', roster);
    assert.equal(out, undefined);
  });
});