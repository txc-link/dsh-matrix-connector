import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderArtifactInlinePreview } from '../lib/artifact-preview.js';

const bytes = (value) => new TextEncoder().encode(value);

test('artifact preview renders markdown as escaped inline source', () => {
  const out = renderArtifactInlinePreview({
    filename: 'plan.md',
    contentType: 'text/markdown; charset=utf-8',
    bytes: bytes('# Plan\n<script>alert(1)</script>'),
  });
  assert.ok(out);
  assert.match(out.body, /# Plan/);
  assert.match(out.html, /&lt;script&gt;/);
  assert.doesNotMatch(out.html, /<script>/);
  assert.equal(out.truncated, false);
});

test('artifact preview truncates large text and directs users to attachment', () => {
  const out = renderArtifactInlinePreview({
    filename: 'report.txt',
    contentType: 'text/plain',
    bytes: bytes('abcdef'),
  }, 3);
  assert.ok(out);
  assert.match(out.body, /abc/);
  assert.doesNotMatch(out.body, /abcdef/);
  assert.match(out.body, /预览已截断/);
  assert.equal(out.truncated, true);
});

test('artifact preview ignores binary artifacts and invalid UTF-8', () => {
  assert.equal(renderArtifactInlinePreview({
    filename: 'image.png',
    contentType: 'image/png',
    bytes: new Uint8Array([1, 2, 3]),
  }), null);
  assert.equal(renderArtifactInlinePreview({
    filename: 'broken.md',
    contentType: 'text/markdown',
    bytes: new Uint8Array([0xff]),
  }), null);
});
