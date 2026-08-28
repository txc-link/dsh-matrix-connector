/**
 * pull-handler.ts — Slice 4 of Phase 2
 *
 * Composes Slice 1 (URI parser) + Slice 2 (posture + audit) + Slice 3 (ACL).
 *
 * Spec: Doc/09-PLANNING/TASKS/2026-08-30-phase-2-matrix-connector/spec-slice-4-pull-handler.md
 * SSoT: Doc/Agora-实施排期-dsh-matrix-connector.md §6 Slice 4
 *
 * @module pull-handler
 */

import { parseAgoraUri, type AgoraUri } from './uri-parser.js';
import { resolvePosture, type PostureDecision, type Op } from './posture-middleware.js';
import { checkAcl, type AclDecision_ } from './acl-bundled.js';
import { appendAuditRecord, type AuditRecord } from './audit-trail.js';

export interface PullRequest {
  actor: string;
  op: Op;
  uri: string;
}

export interface PullResponse {
  status: 'executed' | 'denied' | 'requires_confirm' | 'error';
  parsed?: AgoraUri;
  posture?: PostureDecision;
  acl?: AclDecision_;
  audit?: AuditRecord;
  error?: string;
}

/**
 * Handle a single @pull request.
 *
 * Flow:
 *  1. Parse URI → on fail, status='error' + audit fail
 *  2. Check ACL → on deny, status='denied' + audit fail
 *  3. Resolve posture
 *  4. If Dangerous → status='requires_confirm' + audit pass
 *  5. Otherwise → status='executed' + audit pass
 */
export function handlePull(req: PullRequest): PullResponse {
  // Step 1: Parse URI
  let parsed: AgoraUri;
  try {
    parsed = parseAgoraUri(req.uri);
  } catch (e) {
    const err = e as Error;
    const audit: AuditRecord = {
      ts: new Date().toISOString(),
      actor: req.actor,
      uri: req.uri,
      op: req.op,
      posture: 'Strict',
      result: 'fail',
      error: `URI parse failed: ${err.message}`,
      requiresConfirm: false,
    };
    appendAuditRecord(audit);
    return { status: 'error', error: err.message, audit };
  }

  // Step 2: Check ACL
  const acl = checkAcl({ actor: req.actor, uri: parsed, op: req.op });
  if (acl.decision === 'deny') {
    const audit: AuditRecord = {
      ts: new Date().toISOString(),
      actor: req.actor,
      uri: req.uri,
      op: req.op,
      posture: 'Strict',
      result: 'fail',
      error: `ACL denied: ${acl.reason}`,
      requiresConfirm: false,
    };
    appendAuditRecord(audit);
    return { status: 'denied', parsed, acl, audit };
  }

  // Step 3: Resolve posture
  const posture = resolvePosture({ actor: req.actor, uri: parsed, op: req.op });

  // Step 4: Dangerous requires confirm
  if (posture.posture === 'Dangerous') {
    const audit: AuditRecord = {
      ts: new Date().toISOString(),
      actor: req.actor,
      uri: req.uri,
      op: req.op,
      posture: posture.posture,
      result: 'pass',
      requiresConfirm: true,
    };
    appendAuditRecord(audit);
    return { status: 'requires_confirm', parsed, posture, acl, audit };
  }

  // Step 5: Executed (in real impl, dispatch to Agora Core)
  const audit: AuditRecord = {
    ts: new Date().toISOString(),
    actor: req.actor,
    uri: req.uri,
    op: req.op,
    posture: posture.posture,
    result: 'pass',
    requiresConfirm: false,
  };
  appendAuditRecord(audit);
  return { status: 'executed', parsed, posture, acl, audit };
}
