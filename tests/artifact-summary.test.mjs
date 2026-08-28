/**
 * tests/artifact-summary.test.mjs — RED tests for v1.0.2 artifact
 * summarize. The post-mortem message gets a 'Artifacts (N):' block
 * with the first 240 characters of each text artifact.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeArtifacts } from '../lib/artifact-summary.js';

describe('summarizeArtifacts', () => {
  it('returns an empty block when there are no artifacts', () => {
    const out = summarizeArtifacts([]);
    assert.equal(out, '');
  });

  it('truncates text/plain artifacts to the default 240 chars', () => {
    const long = 'x'.repeat(500);
    const out = summarizeArtifacts([
      { artifact_id: 'a1', name: 'big.txt', media_type: 'text/plain', size_bytes: 500, body: long },
    ]);
    assert.match(out, /big\.txt/);
    assert.match(out, /text\/plain/);
    assert.match(out, /500 bytes/);
    assert.match(out, /\.\.\.$/);
    // The body slice present in the output must be ≤ 243 chars
    // (240 prefix + '...' marker).
    const lines = out.split('\n').filter((l) => l.startsWith('   '));
    const body = lines[lines.length - 1].trim();
    assert.ok(body.length <= 243, `body length was ${body.length}`);
  });

  it('marks binary artifacts without showing their bytes', () => {
    const out = summarizeArtifacts([
      { artifact_id: 'a1', name: 'screenshot.png', media_type: 'image/png', size_bytes: 9999 },
    ]);
    assert.match(out, /screenshot\.png/);
    assert.match(out, /binary/i);
    assert.match(out, /not shown/i);
  });

  it('combines multiple artifacts in input order', () => {
    const out = summarizeArtifacts([
      { artifact_id: 'a1', name: 'first.diff', media_type: 'text/plain', size_bytes: 100, body: 'first content' },
      { artifact_id: 'a2', name: 'second.log', media_type: 'text/plain', size_bytes: 200, body: 'second content' },
    ]);
    const firstIdx = out.indexOf('first.diff');
    const secondIdx = out.indexOf('second.log');
    assert.ok(firstIdx > -1 && secondIdx > -1 && firstIdx < secondIdx, 'must preserve input order');
    assert.match(out, /first content/);
    assert.match(out, /second content/);
  });

  it('prefixes with a header line when there is at least one artifact', () => {
    const out = summarizeArtifacts([
      { artifact_id: 'a1', name: 'x.txt', media_type: 'text/plain', size_bytes: 5, body: 'hello' },
    ]);
    assert.match(out, /artifacts \(/);
  });
});