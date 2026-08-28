/**
 * agora-rest unit tests.
 *
 * Verify request shape + URL building + error propagation against a
 * stub fetch implementation. No real HTTP.
 *
 * NB: listCitizens / getCitizen / pollEvents now throw EndpointNotDeployedError
 * on the deployed server (probe 2026-08-28). The tests assert that contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AgoraRestClient, EndpointNotDeployedError } from '../lib/agora-rest.js';

function makeFetch(captured, responder) {
  return async (url, init) => {
    captured.push({ url, init });
    return responder(init);
  };
}

function okJson(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name === 'content-type' ? 'application/json' : null) },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

test('agora-rest: listTemplates GETs /api/templates', async () => {
  const captured = [];
  const fetchImpl = makeFetch(captured, () => okJson([
    { id: 'quick', name: 'Quick', type: 'quick', description: 'one-shot', governance: 'lean', stage_count: 1 },
  ]));
  const client = new AgoraRestClient({ baseUrl: 'http://127.0.0.1:18008', apiToken: 'tok', fetchImpl });
  const templates = await client.listTemplates();
  assert.equal(templates.length, 1);
  assert.equal(templates[0].id, 'quick');
  assert.match(captured[0].url, /\/api\/templates$/);
  assert.equal(captured[0].init.headers.Authorization, 'Bearer tok');
});

test('agora-rest: createTask posts the v0.6.0 schema (not the v0.1-ideal shape)', async () => {
  const captured = [];
  const fetchImpl = makeFetch(captured, () => okJson({ id: 't-1', state: 'pending', type: 'quick', title: 'hello', creator: '@u:hs' }));
  const client = new AgoraRestClient({ baseUrl: 'http://127.0.0.1:18008', apiToken: 'tok', fetchImpl });
  const response = await client.createTask({
    title: 'hello',
    type: 'quick',
    creator: '@u:hs',
    description: 'ask something',
    priority: 'normal',
  });
  assert.equal(response.id, 't-1');
  const body = JSON.parse(captured[0].init.body);
  assert.equal(body.title, 'hello');
  assert.equal(body.type, 'quick');
  assert.equal(body.creator, '@u:hs');
  assert.equal(body.priority, 'normal');
  // threadKey must NOT cross the wire.
  assert.equal(body.threadKey, undefined);
  assert.equal(body.actor, undefined);
});

test('agora-rest: listCitizens throws EndpointNotDeployedError (not deployed)', async () => {
  const fetchImpl = makeFetch([], () => okJson({ citizens: [] }));
  const client = new AgoraRestClient({ baseUrl: 'http://127.0.0.1:18008', apiToken: 'tok', fetchImpl });
  await assert.rejects(client.listCitizens('node-a'), (err) => {
    assert.ok(err instanceof EndpointNotDeployedError);
    assert.match(err.message, /\/api\/citizens/);
    return true;
  });
});

test('agora-rest: getCitizen throws EndpointNotDeployedError (not deployed)', async () => {
  const fetchImpl = makeFetch([], () => okJson({}));
  const client = new AgoraRestClient({ baseUrl: 'http://127.0.0.1:18008', apiToken: 'tok', fetchImpl });
  await assert.rejects(client.getCitizen('cit-a'), (err) => err instanceof EndpointNotDeployedError);
});

test('agora-rest: pollEvents throws EndpointNotDeployedError (not deployed)', async () => {
  const fetchImpl = makeFetch([], () => okJson({ events: [], next_since: 0 }));
  const client = new AgoraRestClient({ baseUrl: 'http://127.0.0.1:18008', apiToken: 'tok', fetchImpl });
  await assert.rejects(client.pollEvents(0), (err) => err instanceof EndpointNotDeployedError);
});

test('agora-rest: error response throws with status + body', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 500,
    text: async () => 'boom',
    json: async () => ({}),
  });
  const client = new AgoraRestClient({ baseUrl: 'http://127.0.0.1:18008', apiToken: 'tok', fetchImpl, timeoutMs: 1000 });
  await assert.rejects(client.health(), /agora GET \/api\/health failed: 500 boom/);
});

test('agora-rest: getArtifactContent returns bytes via arrayBuffer', async () => {
  const responses = {
    artifactMeta: { id: 'sha256-x', name: 'a.txt', media_type: 'text/plain', size_bytes: 5, kind: 'log', sha256: 'sha256-x' },
  };
  const fetchImpl = async (url, init) => {
    if (url.includes('/api/artifacts/sha256-x/content')) {
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => (name === 'content-type' ? 'text/plain' : null) },
        text: async () => 'plain bytes',
        arrayBuffer: async () => new TextEncoder().encode('plain bytes').buffer,
      };
    }
    if (url.includes('/api/artifacts/sha256-x')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify(responses.artifactMeta),
        json: async () => responses.artifactMeta,
      };
    }
    return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
  };
  const client = new AgoraRestClient({ baseUrl: 'http://127.0.0.1:18008', apiToken: 'tok', fetchImpl });
  const c = await client.getArtifactContent('sha256-x');
  assert.equal(c.media_type, 'text/plain');
  assert.equal(c.name, 'a.txt');
  assert.equal(new TextDecoder().decode(c.bytes), 'plain bytes');
});

test('agora-rest: searchBrain POSTs context/retrieve with the v0.6.0 shape', async () => {
  const captured = [];
  const fetchImpl = makeFetch(captured, () => okJson({
    scope: 'project_context',
    mode: 'lookup',
    results: { hits: [] },
  }));
  const client = new AgoraRestClient({ baseUrl: 'http://127.0.0.1:18008', apiToken: 'tok', fetchImpl });
  await client.searchBrain('node-a', 'hello world', 3);
  assert.match(captured[0].url, /\/api\/projects\/node-a\/context\/retrieve$/);
  const body = JSON.parse(captured[0].init.body);
  assert.equal(body.q, 'hello world');
  assert.equal(body.limit, 3);
  assert.equal(body.mode, 'lookup');
});