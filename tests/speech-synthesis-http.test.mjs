/**
 * FishSpeechSpeechAdapter unit tests.
 *
 * Exercise the adapter against a real local HTTP server (node:http), so
 * request JSON, WAV parsing, error mapping, timeout handling and the
 * serialization queue are all verified without touching the GPU box.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { FishSpeechSpeechAdapter } from '../lib/speech-synthesis-http.js';

function makeWav(durationMs = 1000, sampleRate = 8000) {
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return new Uint8Array(buffer);
}

async function withServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('fish-speech adapter synthesizes wav bytes and parses duration', async () => {
  const bodies = [];
  const server = await withServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      bodies.push({ url: req.url, contentType: req.headers['content-type'], body: JSON.parse(raw) });
      const wav = makeWav(1000);
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length });
      res.end(Buffer.from(wav));
    });
  });
  try {
    const adapter = new FishSpeechSpeechAdapter({
      baseUrl: server.baseUrl,
      referenceId: 'myvoice',
    });
    const speech = await adapter.synthesize('你好，这是一次测试');
    assert.equal(speech.contentType, 'audio/wav');
    assert.match(speech.filename, /\.wav$/);
    assert.ok(Math.abs(speech.durationMs - 1000) <= 10, `duration=${speech.durationMs}`);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].url, '/v1/tts');
    assert.match(bodies[0].contentType, /application\/json/);
    assert.equal(bodies[0].body.text, '你好，这是一次测试');
    assert.equal(bodies[0].body.reference_id, 'myvoice');
    assert.equal(bodies[0].body.format, 'wav');
    assert.equal(bodies[0].body.streaming, false);
    assert.equal(bodies[0].body.chunk_length, 200);
  } finally {
    await server.close();
  }
});

test('fish-speech adapter rejects empty text without hitting the network', async () => {
  const server = await withServer(() => {
    throw new Error('must not be called');
  });
  try {
    const adapter = new FishSpeechSpeechAdapter({ baseUrl: server.baseUrl });
    await assert.rejects(() => adapter.synthesize('   '), /speech text is required/);
  } finally {
    await server.close();
  }
});

test('fish-speech adapter maps JSON error responses', async () => {
  const server = await withServer((_req, res) => {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'tts failed', detail: 'reference not found' }));
  });
  try {
    const adapter = new FishSpeechSpeechAdapter({ baseUrl: server.baseUrl });
    await assert.rejects(() => adapter.synthesize('你好'), /fish-speech \/v1\/tts failed: HTTP 400/);
  } finally {
    await server.close();
  }
});

test('fish-speech adapter rejects JSON returned as 200', async () => {
  const server = await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'no audio' }));
  });
  try {
    const adapter = new FishSpeechSpeechAdapter({ baseUrl: server.baseUrl });
    await assert.rejects(() => adapter.synthesize('你好'), /returned JSON instead of audio/);
  } finally {
    await server.close();
  }
});

test('fish-speech adapter serializes concurrent synthesis (queue depth 1)', async () => {
  let active = 0;
  let maxActive = 0;
  let finished = 0;
  const server = await withServer((_req, res) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    setTimeout(() => {
      const wav = makeWav(200);
      res.writeHead(200, { 'content-type': 'audio/wav' });
      res.end(Buffer.from(wav));
      active -= 1;
      finished += 1;
    }, 30);
  });
  try {
    const adapter = new FishSpeechSpeechAdapter({ baseUrl: server.baseUrl });
    const results = await Promise.all([
      adapter.synthesize('第一条'),
      adapter.synthesize('第二条'),
      adapter.synthesize('第三条'),
    ]);
    assert.equal(results.length, 3);
    assert.equal(finished, 3);
    assert.equal(maxActive, 1);
  } finally {
    await server.close();
  }
});

test('fish-speech adapter times out slow requests', async () => {
  const server = await withServer((_req, res) => {
    setTimeout(() => res.end(), 5_000);
  });
  try {
    const adapter = new FishSpeechSpeechAdapter({ baseUrl: server.baseUrl, timeoutMs: 25 });
    await assert.rejects(() => adapter.synthesize('你好'), /timed out after 25ms/);
  } finally {
    await server.close();
  }
});
