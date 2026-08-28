#!/usr/bin/env node
/**
 * smoke-v02-sse.mjs — verify the agora central SSE endpoint is reachable
 * and pushes tick frames for a freshly-dispatched task.
 *
 * Standalone smoke (does not boot the dsh-matrix-connector plugin). It
 * exercises the same SSE contract the plugin's v0.2 listener uses:
 *   - open GET /api/events/stream?task_id=<id>&since=0
 *   - expect at least one `event: tick` frame whose `data:` JSON
 *     contains `task_id === <id>`
 *
 * Required env:
 *   MATRIX_HOMESERVER_URL, MATRIX_USER_ID, MATRIX_ACCESS_TOKEN,
 *   MATRIX_DEVICE_ID, AGORA_SERVER_URL, AGORA_API_TOKEN
 */

import assert from 'node:assert/strict';

class Skipped extends Error {}

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Skipped(`missing env ${name}`);
  }
  return value;
}

const HOMESERVER = required('MATRIX_HOMESERVER_URL');
const USER_ID = required('MATRIX_USER_ID');
const ACCESS_TOKEN = required('MATRIX_ACCESS_TOKEN');
const DEVICE_ID = required('MATRIX_DEVICE_ID');
const AGORA = required('AGORA_SERVER_URL');
const AGORA_TOKEN = required('AGORA_API_TOKEN');

async function http(method, url, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${url} failed: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : undefined;
}

const agora = {
  h: () => ({ Authorization: `Bearer ${AGORA_TOKEN}` }),
};

async function dispatchTask() {
  const task = await http(
    'POST',
    `${AGORA}/api/tasks`,
    {
      title: `v0.2 SSE smoke ${new Date().toISOString()}`,
      type: 'quick',
      creator: USER_ID,
      description: 'v0.2 SSE verification',
      priority: 'normal',
    },
    agora.h(),
  );
  return task.id;
}

async function subscribeSse(taskId) {
  const url = `${AGORA}/api/events/stream?task_id=${encodeURIComponent(taskId)}&since=0`;
  const response = await fetch(url, { headers: agora.h() });
  if (response.status !== 200) {
    throw new Error(`SSE open failed: ${response.status}`);
  }
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    throw new Error(`SSE wrong content-type: ${ct}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const ticks = [];
  const start = Date.now();
  // The task may have already written flow_log rows before we subscribe
  // (the smoke dispatches first, then subscribes). Since `since=0` the
  // server will replay them in seq order. We accept either that the first
  // tick arrives within the first 5s, or the connection stays open with
  // a heartbeat comment for the full window (also acceptable).
  while (Date.now() - start < 5000) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      try {
        const parsed = JSON.parse(dataLine.slice(5).trim());
        if (parsed.task_id === taskId) ticks.push(parsed);
      } catch {
        /* ignore non-JSON frames */
      }
    }
  }
  await reader.cancel();
  return ticks;
}

async function main() {
  console.log('== smoke-v02-sse v0.2 ==');
  console.log('agora:', AGORA);
  console.log('homeserver:', HOMESERVER);

  // 1. dispatch
  const taskId = await dispatchTask();
  console.log('task_id:', taskId);

  // 2. subscribe
  const ticks = await subscribeSse(taskId);
  console.log(`ticks observed for task: ${ticks.length}`);
  for (const t of ticks) {
    console.log(`  - seq=${t.seq} type=${t.type} state=${t.state ?? '-'}`);
  }

  // 3. assert — we expect at least one tick whose task_id matches.
  //    A real task lifecycle writes multiple flow_log rows in seq order.
  assert.ok(ticks.length >= 1, 'expected at least one tick matching task_id');

  console.log('OK smoke-v02-sse passed.');
}

main().catch((err) => {
  if (err instanceof Skipped) {
    console.warn(`SMOKE SKIPPED: ${err.message}`);
    process.exit(0);
  }
  console.error('SMOKE FAILED:', err);
  process.exit(1);
});