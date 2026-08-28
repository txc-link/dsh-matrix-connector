/**
 * acl-bundled.ts — Slice 3 of Phase 2
 *
 * Bundled ACL table for dsh-matrix-connector (per U4=A decision).
 * Pure function: checkAcl(ctx) → allow/deny decision.
 *
 * Spec: Doc/09-PLANNING/TASKS/2026-08-30-phase-2-matrix-connector/spec-slice-3-acl-bundled.md
 * SSoT: Doc/Agora-实施排期-dsh-matrix-connector.md §5 (ACL bundled)
 *
 * @module acl-bundled
 */

import type { AgoraUri } from './uri-parser.js';
import type { Op } from './posture-middleware.js';

export type AclDecision = 'allow' | 'deny';

export interface AclCheckContext {
  actor: string;
  uri: AgoraUri;
  op: Op;
}

export interface AclDecision_ {
  decision: AclDecision;
  reason: string;
}

export interface AclEntry {
  type: string;            // 'task' | 'event' | 'participant' | 'execution' | '*'
  op: Op | '*';            // 'read' | 'write' | 'delete' | 'execute' | '*'
  sub?: string;            // optional sub-path scope
}

export const ACL_TABLE: ReadonlyMap<string, ReadonlyArray<AclEntry>> = new Map<string, ReadonlyArray<AclEntry>>([
  ['human:dashboard', [
    { type: '*', op: '*' },
  ]],

  ['agent:claude-code', [
    { type: 'task', op: 'read' },
    { type: 'task', op: 'write' },
    { type: 'task', op: 'execute' },
    { type: 'event', op: '*' },
    { type: 'participant', op: 'read' },
    { type: 'execution', op: 'read' },
  ]],

  ['agent:matrix-bridge', [
    { type: 'event', op: 'read' },
  ]],

  ['agent:postmortem-bot', [
    { type: 'task', op: 'read', sub: 'postmortem' },
  ]],
]);

/**
 * Check ACL for a (actor, uri, op) triple.
 *
 * Returns 'allow' if any ACL entry matches:
 *   - entry.type === uri.type OR entry.type === '*'
 *   - entry.op === op OR entry.op === '*'
 *   - entry.sub === uri.sub OR entry.sub === undefined (no sub constraint)
 *
 * Returns 'deny' otherwise.
 */
export function checkAcl(ctx: AclCheckContext): AclDecision_ {
  const entries = ACL_TABLE.get(ctx.actor);

  // Default deny for unknown actor
  if (entries === undefined) {
    return {
      decision: 'deny',
      reason: `unknown actor '${ctx.actor}'; no ACL entry`,
    };
  }

  for (const entry of entries) {
    // Check type match
    if (entry.type !== '*' && entry.type !== ctx.uri.type) continue;

    // Check op match
    if (entry.op !== '*' && entry.op !== ctx.op) continue;

    // Check sub constraint
    if (entry.sub !== undefined && entry.sub !== ctx.uri.sub) continue;

    // All checks passed
    return {
      decision: 'allow',
      reason: `${ctx.actor} allowed ${ctx.op} on ${ctx.uri.type}${ctx.uri.sub ? '/' + ctx.uri.sub : ''} (rule: ${entry.type}/${entry.op}${entry.sub ? '/' + entry.sub : ''})`,
    };
  }

  return {
    decision: 'deny',
    reason: `${ctx.actor} has no ACL entry matching ${ctx.op} on ${ctx.uri.type}`,
  };
}
