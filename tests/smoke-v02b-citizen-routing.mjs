#!/usr/bin/env node
/**
 * smoke-v02b-citizen-routing.mjs — verify that POST /api/tasks with a
 * team_override.members[0].agentId = "<citizen>" makes the agora central
 * create a task whose team actually pins to that agent.
 *
 * Required env: MATRIX_*, AGORA_SERVER_URL, AGORA_API_TOKEN.
 */

import assert from 'node:assert/strict';

class Skipped extends Error {}
function required(name) {
  const value = process.env[name];
  if (!value) process.exit(0)(`missing env ${name}`);
  return value;
}

required('MATRIX_HOMESERVER_URL');
required('MATRIX_USER_ID');
required('MATRIX_ACCESS_TOKEN');
required('MATRIX_DEVICE_ID');
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

const hdr = () => ({ Authorization: `Bearer ${AGORA_TOKEN}` });

const CITIZEN_ID = `smoke-v02b-${Date.now()}`;

console.log('== smoke-v02b-citizen-routing ==');
console.log('agora:', AGORA);
console.log('target citizen_id:', CITIZEN_ID);

const task = await http(
  'POST',
  `${AGORA}/api/tasks`,
  {
    title: `v0.2b citizen routing smoke ${new Date().toISOString()}`,
    type: 'quick',
    creator: process.env.MATRIX_USER_ID,
    description: 'verify team_override routes to specific agent',
    priority: 'normal',
    team_override: {
      members: [
        {
          role: 'executor',
          agentId: CITIZEN_ID,
          member_kind: 'citizen',
          model_preference: '',
        },
      ],
    },
  },
  hdr(),
);

console.log('task_id:', task.id);
console.log('response.team.members[0]:', JSON.stringify(task.team.members[0], null, 2));

// §1 — threadKey MUST NOT appear in the response payload (not even
// echoed). Just sanity-check the obvious fields are present.
assert.ok(task.team, 'response.team should be present');
assert.equal(task.team.members.length, 1, 'team should have exactly one member');
assert.equal(task.team.members[0].agentId, CITIZEN_ID, 'agentId must match the requested citizen');
assert.equal(task.team.members[0].member_kind, 'citizen', 'member_kind must be citizen');
assert.equal(task.team.members[0].role, 'executor', 'role must be executor');
assert.equal(task.threadKey, undefined, 'threadKey must never appear in the response');
assert.equal(task.actor, undefined, 'actor must never appear in the response');

console.log('OK smoke-v02b-citizen-routing passed.');