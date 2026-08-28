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
import { resolvePosture, type PostureDecision, type Op, type Posture } from './posture-middleware.js';
import { checkAcl, type AclDecision_ } from './acl-bundled.js';
import { appendAuditRecord, type AuditRecord } from './audit-trail.js';
import { loadThreadRegistry, saveThreadRegistry, resolveRegistryPath } from './thread-registry.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// v0.4 (R4): thread Room auto-create
// ─────────────────────────────────────────────────────────────────────────────

export interface RoomCreatePullRequest {
  actor: string;
  op: Op;
  uri: string;
  /** JSONL registry path; defaults to resolveRegistryPath(). */
  registryPath?: string;
  /** Audit trail path; defaults to audit-trail resolveAuditPath(). */
  auditPath?: string;
  /** Posture override; defaults to resolvePosture(actor, uri, op). */
  posture?: Posture;
  /** Room-create transport (composition root injects MatrixClient.createRoom). */
  createRoom?: (name: string, opts: { topic: string }) => Promise<{ roomId: string }>;
}

export interface RoomCreatePullResponse {
  status: 'executed' | 'denied' | 'requires_confirm' | 'error';
  roomId?: string;
  threadKey?: string;
  dualApprovalRequired?: boolean;
  error?: string;
}

/**
 * Handle a thread @pull with Room auto-create.
 *
 * Flow (thread URIs only):
 *  1. Parse URI → error on failure
 *  2. Resolve posture (override or middleware)
 *  3. Dangerous → requires_confirm + dualApprovalRequired (no room touched)
 *     Strict   → requires_confirm (no room touched)
 *  4. Auto → registry lookup; existing room reused; otherwise createRoom,
 *     persist binding, audit room_created
 */
export async function handlePullWithRoomCreate(req: RoomCreatePullRequest): Promise<RoomCreatePullResponse> {
  let parsed: AgoraUri;
  try {
    parsed = parseAgoraUri(req.uri);
  } catch (e) {
    return { status: 'error', error: (e as Error).message };
  }

  if (parsed.type !== 'thread') {
    return { status: 'error', error: `unsupported type '${parsed.type}'; room auto-create is for thread URIs` };
  }
  const threadKey = parsed.id;

  const posture = req.posture ?? resolvePosture({ actor: req.actor, uri: parsed, op: req.op }).posture;

  if (posture === 'Dangerous') {
    return { status: 'requires_confirm', threadKey, dualApprovalRequired: true };
  }
  if (posture === 'Strict') {
    return { status: 'requires_confirm', threadKey };
  }

  // Auto: ensure the per-thread room exists.
  const registryPath = req.registryPath ?? resolveRegistryPath();
  const registry = loadThreadRegistry(registryPath);
  const existing = registry.get(threadKey);
  if (existing !== undefined) {
    appendAuditRecord({
      ts: new Date().toISOString(),
      actor: req.actor,
      uri: req.uri,
      op: req.op,
      posture,
      result: 'pass',
      requiresConfirm: false,
      event: 'room_reused',
    }, req.auditPath);
    return { status: 'executed', roomId: existing.roomId, threadKey };
  }

  if (typeof req.createRoom !== 'function') {
    return { status: 'error', error: 'no createRoom transport provided' };
  }

  let roomId: string;
  try {
    const receipt = await req.createRoom(`Thread ${threadKey}`, { topic: threadKey });
    roomId = receipt.roomId;
  } catch (e) {
    return { status: 'error', error: `room create failed: ${(e as Error).message}` };
  }

  const ts = new Date().toISOString();
  registry.upsert({
    threadKey,
    roomId,
    placeholderEventId: null,
    taskId: null,
    createdAt: ts,
    updatedAt: ts,
  });
  saveThreadRegistry(registry, registryPath);

  appendAuditRecord({
    ts,
    actor: req.actor,
    uri: req.uri,
    op: req.op,
    posture,
    result: 'pass',
    requiresConfirm: false,
    event: 'room_created',
  }, req.auditPath);

  return { status: 'executed', roomId, threadKey };
}
