import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readWavDurationMs, WindowsSapiSpeechAdapter } from '../lib/speech-synthesis.js';

function wav(byteRate, dataBytes) {
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  for (const [at, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
    for (let i = 0; i < text.length; i += 1) bytes[at + i] = text.charCodeAt(i);
  }
  view.setUint32(16, 16, true);
  view.setUint32(28, byteRate, true);
  view.setUint32(40, dataBytes, true);
  return bytes;
}

test('WAV duration reader uses byte rate and data chunk length', () => {
  assert.equal(readWavDurationMs(wav(16000, 32000)), 2000);
});

test('Windows SAPI adapter passes text through a file, never interpolates it into PowerShell args', async () => {
  const invocations = [];
  const adapter = new WindowsSapiSpeechAdapter({
    voiceName: 'Microsoft Huihui',
    runner: async (request) => {
      invocations.push(request);
      assert.equal(request.args.includes('hello; Remove-Item *'), false);
      return wav(16000, 16000);
    },
  });
  const result = await adapter.synthesize('hello; Remove-Item *');
  assert.equal(result.contentType, 'audio/wav');
  assert.equal(result.durationMs, 1000);
  assert.match(result.filename, /\.wav$/);
  assert.equal(invocations[0].text, 'hello; Remove-Item *');
});

