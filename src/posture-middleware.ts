/**
 * posture-middleware.ts — Slice 2 of Phase 2
 *
 * Resolves (actor, uri, op) → posture decision + audit context.
 * No IO outside the audit-trail append (which is in audit-trail.ts).
 *
 * Spec: Doc/09-PLANNING/TASKS/2026-08-30-phase-2-matrix-connector/spec-slice-2-posture-middleware.md
 * SSoT: Doc/Agora-实施排期-dsh-matrix-connector.md §4.4 (三 posture governance)
 *
 * @module posture-middleware
 */

import type { AgoraUri } from './uri-parser.js';

export type Posture = 'Strict' | 'Auto' | 'Dangerous';
export type Op = 'read' | 'write' | 'delete' | 'execute';

export interface PostureDecision {
  posture: Posture;
  requiresConfirm: boolean;
  reason: string;
}

export interface PostureContext {
  actor: string;
  uri: AgoraUri;
  op: Op;
}

/**
 * Posture resolution table.
 * Key format: `${actor}|${uri.type}|${op}`
 * Value: the resolved posture.
 *
 * Built from spec-slice-2 §5.
 */
function makeKey(actor: string, type: string, op: Op): string {
  return `${actor}|${type}|${op}`;
}

export const POSTURE_TABLE: ReadonlyMap<string, Posture> = new Map<string, Posture>([
  // dashboard: all Strict by default (per spec §5 line 1)
  // (entry below is "delete" override → Dangerous)
  [makeKey('human:dashboard', '*', 'delete'), 'Dangerous'],

  // claude-code: task/participant/execution writes Strict, reads Auto
  [makeKey('agent:claude-code', 'task', 'read'), 'Auto'],
  [makeKey('agent:claude-code', 'task', 'write'), 'Strict'],
  [makeKey('agent:claude-code', 'task', 'delete'), 'Dangerous'],
  [makeKey('agent:claude-code', 'participant', 'read'), 'Auto'],
  [makeKey('agent:claude-code', 'participant', 'write'), 'Strict'],
  [makeKey('agent:claude-code', 'participant', 'delete'), 'Dangerous'],
  [makeKey('agent:claude-code', 'execution', 'read'), 'Auto'],
  [makeKey('agent:claude-code', 'execution', 'write'), 'Strict'],
  [makeKey('agent:claude-code', 'execution', 'delete'), 'Dangerous'],
  // claude-code: event = Auto always
  [makeKey('agent:claude-code', 'event', 'read'), 'Auto'],
  [makeKey('agent:claude-code', 'event', 'write'), 'Auto'],
  [makeKey('agent:claude-code', 'event', 'delete'), 'Dangerous'],
  [makeKey('agent:claude-code', 'event', 'execute'), 'Auto'],

  // matrix-bridge: event read = Auto, others Strict
  [makeKey('agent:matrix-bridge', 'event', 'read'), 'Auto'],
  [makeKey('agent:matrix-bridge', 'event', 'delete'), 'Dangerous'],

  // postmortem-bot: task read = Auto
  [makeKey('agent:postmortem-bot', 'task', 'read'), 'Auto'],
]);

/**
 * Resolve posture for a (actor, uri, op) triple.
 * Default fail-safe: Strict (never Auto or Dangerous for unknown).
 */
export function resolvePosture(ctx: PostureContext): PostureDecision {
  // First: try the exact (actor, type, op) match
  let resolved = POSTURE_TABLE.get(makeKey(ctx.actor, ctx.uri.type, ctx.op));

  // Second: try with wildcard type for the same actor + op
  if (resolved === undefined) {
    resolved = POSTURE_TABLE.get(makeKey(ctx.actor, '*', ctx.op));
  }

  // Third: hardcoded default for delete op → Dangerous (per spec §5)
  if (resolved === undefined && ctx.op === 'delete') {
    return {
      posture: 'Dangerous',
      requiresConfirm: true,
      reason: 'default: any delete op is Dangerous',
    };
  }

  // Fourth: unknown = Strict (fail-safe)
  if (resolved === undefined) {
    resolved = 'Strict';
  }

  const requiresConfirm = resolved === 'Dangerous';

  return {
    posture: resolved,
    requiresConfirm,
    reason: buildReason(ctx, resolved),
  };
}

function buildReason(ctx: PostureContext, posture: Posture): string {
  return `${ctx.actor} ${ctx.op} ${ctx.uri.type} → ${posture}`;
}
