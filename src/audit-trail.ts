/**
 * audit-trail.ts — Slice 2 of Phase 2
 *
 * Append-only JSONL audit trail writer for posture decisions.
 * Default path: ~/.agora/audit-trail/dsh-matrix-connector.jsonl
 *
 * Sandbox fallback: if homedir() is not writable (sandbox EROFS / ENOENT),
 * the module auto-cascades through these paths in order:
 *   1. process.env.AGORA_AUDIT_PATH (if set)
 *   2. ~/.agora/audit-trail/dsh-matrix-connector.jsonl
 *   3. .agora/audit-trail/dsh-matrix-connector.jsonl (workspace relative)
 *
 * Spec: Doc/09-PLANNING/TASKS/2026-08-30-phase-2-matrix-connector/spec-slice-2-posture-middleware.md
 * SSoT: Doc/Agora-实施排期-dsh-matrix-connector.md §4.4 (audit trail middleware)
 *
 * @module audit-trail
 */

import { appendFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { Posture, Op } from './posture-middleware.js';

export interface AuditRecord {
  ts: string;
  actor: string;
  uri: string;
  op: Op;
  posture: Posture;
  result: 'pass' | 'fail';
  error?: string;
  requiresConfirm: boolean;
}

export const DEFAULT_AUDIT_PATH: string = join(
  homedir(),
  '.agora',
  'audit-trail',
  'dsh-matrix-connector.jsonl',
);

/**
 * Resolve the audit trail path with fallback for sandbox EROFS.
 * Tries in order:
 *   1. AGORA_AUDIT_PATH env var
 *   2. ~/.agora/audit-trail/dsh-matrix-connector.jsonl
 *   3. .agora/audit-trail/dsh-matrix-connector.jsonl (workspace relative)
 */
export function resolveAuditPath(): string {
  const envPath = process.env.AGORA_AUDIT_PATH;
  if (envPath) return envPath;

  const homePath = DEFAULT_AUDIT_PATH;
  const homeDir = dirname(homePath);
  // Probe homedir() writability via mkdirSync (recursive: false to fail fast)
  try {
    if (!existsSync(homeDir)) {
      mkdirSync(homeDir, { recursive: false });
    }
    return homePath;
  } catch (e) {
    // Fallback to workspace-relative
    return join(process.cwd(), '.agora', 'audit-trail', 'dsh-matrix-connector.jsonl');
  }
}

/**
 * Append a single AuditRecord to the JSONL file.
 * Creates parent directory if missing. Falls back to writable path on EROFS.
 */
export function appendAuditRecord(record: AuditRecord, path?: string): void {
  const targetPath = path ?? resolveAuditPath();
  const dir = dirname(targetPath);
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(targetPath, JSON.stringify(record) + '\n', 'utf-8');
  } catch (e) {
    // If explicit path failed, try fallback path
    if (path === undefined) {
      const fallbackPath = join(process.cwd(), '.agora', 'audit-trail', 'dsh-matrix-connector.jsonl');
      const fallbackDir = dirname(fallbackPath);
      if (!existsSync(fallbackDir)) {
        mkdirSync(fallbackDir, { recursive: true });
      }
      appendFileSync(fallbackPath, JSON.stringify(record) + '\n', 'utf-8');
    } else {
      throw e;
    }
  }
}

/**
 * Read all AuditRecords from the JSONL file.
 * Returns empty array if file does not exist.
 */
export function readAuditRecords(path: string = DEFAULT_AUDIT_PATH): readonly AuditRecord[] {
  if (!existsSync(path)) {
    return [];
  }
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n').filter((line) => line.length > 0);
  return lines.map((line) => JSON.parse(line) as AuditRecord);
}
