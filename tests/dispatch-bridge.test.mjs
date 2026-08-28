/**
 * tests/dispatch-bridge.test.mjs — RED tests for parseDispatchArgs.
 *
 * The new /agora dispatch @<citizen_id> <prompt...> command needs a parser
 * that pulls out the optional @mention prefix and the remaining prompt.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDispatchArgs } from '../lib/dispatch-args.js';

describe('parseDispatchArgs', () => {
  it('returns empty prompt error when args is empty', () => {
    assert.throws(() => parseDispatchArgs([]), /requires/);
  });

  it('treats a leading @mention as citizen_id and the rest as prompt', () => {
    const out = parseDispatchArgs(['@code-reviewer', '帮我审', 'PR', '#42']);
    assert.equal(out.citizen_id, 'code-reviewer');
    assert.equal(out.prompt, '帮我审 PR #42');
  });

  it('treats a leading bare word as citizen_id when followed by another word', () => {
    const out = parseDispatchArgs(['code-reviewer', '帮我审', 'PR']);
    assert.equal(out.citizen_id, 'code-reviewer');
    assert.equal(out.prompt, '帮我审 PR');
  });

  it('falls back to plain prompt when the first token is the only token', () => {
    const out = parseDispatchArgs(['帮我审', 'PR', '#42']);
    assert.equal(out.citizen_id, undefined);
    assert.equal(out.prompt, '帮我审 PR #42');
  });

  it('preserves an empty @mention (just "@") as a literal prompt token', () => {
    const out = parseDispatchArgs(['@', 'foo', 'bar']);
    assert.equal(out.citizen_id, undefined);
    assert.equal(out.prompt, '@ foo bar');
  });
});