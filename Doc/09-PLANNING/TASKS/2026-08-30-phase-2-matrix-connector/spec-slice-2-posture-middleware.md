# Spec Brief — Slice 2 (Posture Middleware + Audit Trail)

**Spec ID**: `2026-08-30-slice-2-posture-middleware`
**Date**: 2026-08-29 (Asia/Shanghai)
**Owner**: 总工
**Related SSoT**: [Doc/Agora-实施排期-dsh-matrix-connector.md §4.4 + §5 + §6 Slice 2](../../../../Agora-实施排期-dsh-matrix-connector.md#4-三-posture-governance-u3c-实施)
**Related task_plan**: [task_plan.md §3 Slice 2 Plan](../../../../Doc/09-PLANNING/TASKS/2026-08-30-phase-2-matrix-connector/task_plan.md)

---

## 1. Outcome

Two pure modules:

- `src/posture-middleware.ts`: resolves `(actor, uri, op)` → `{ posture, requiresConfirm }`
- `src/audit-trail.ts`: append-only JSONL writer for posture decisions

**No IO outside audit-trail append (which writes to local JSONL). No state.**

## 2. Why

- Slice 2 = bridge between URI parser (Slice 1) and ACL bundled (Slice 3)
- Posture = "level of caution" the adapter takes when handling a request
- Audit trail = observable evidence + compliance log

## 3. Non-goals

- ❌ No remote audit trail (Phase 3+ if needed)
- ❌ No DB persistence (JSONL only, per SSoT §4.4)
- ❌ No async / queue (synchronous append)
- ❌ No actor auth (Slice 3 ACL handles that)
- ❌ No auto-execute (posture = decision only, not executor)

## 4. Public API Surface

### 4.1 `src/posture-middleware.ts`

```typescript
export type Posture = 'Strict' | 'Auto' | 'Dangerous';
export type Op = 'read' | 'write' | 'delete' | 'execute';

export interface PostureDecision {
  posture: Posture;
  requiresConfirm: boolean;  // true for Dangerous
  reason: string;            // debug string
}

export interface PostureContext {
  actor: string;             // e.g. "human:dashboard", "agent:claude-code"
  uri: AgoraUri;             // parsed URI from Slice 1
  op: Op;
}

export function resolvePosture(ctx: PostureContext): PostureDecision;

export const POSTURE_TABLE: ReadonlyMap<string, Posture>;  // key = `${actor}|${uri.type}|${op}`
```

### 4.2 `src/audit-trail.ts`

```typescript
export interface AuditRecord {
  ts: string;                // ISO 8601 UTC
  actor: string;
  uri: string;               // original string form
  op: Op;
  posture: Posture;
  result: 'pass' | 'fail';
  error?: string;            // if result === 'fail'
  requiresConfirm: boolean;
}

export const DEFAULT_AUDIT_PATH: string;  // ~/.agora/audit-trail/dsh-matrix-connector.jsonl

export function appendAuditRecord(record: AuditRecord, path?: string): void;

export function readAuditRecords(path?: string): readonly AuditRecord[];
```

## 5. Posture Resolution Rules (default table)

| actor | uri.type | op | posture | requiresConfirm |
|---|---|---|---|---|
| `human:dashboard` | * | * | Strict | false |
| `agent:claude-code` | task / participant / execution | write / delete / execute | Strict | false |
| `agent:claude-code` | task / participant / execution | read | Auto | false |
| `agent:claude-code` | event | * | Auto | false |
| `agent:matrix-bridge` | event | read | Auto | false |
| `agent:matrix-bridge` | * | write / delete / execute | Strict | false |
| `agent:postmortem-bot` | task | read | Auto | false |
| * | * | delete | Dangerous | true |
| (default) | * | * | Strict | false |

## 6. Test Coverage (12 cases)

| # | Test | Expected |
|---|---|---|
| 1 | resolve `claude-code` + `task` + `write` | Strict, no confirm |
| 2 | resolve `claude-code` + `event` + `read` | Auto, no confirm |
| 3 | resolve `dashboard` + `task` + `delete` | Dangerous, requires confirm |
| 4 | resolve `matrix-bridge` + `event` + `read` | Auto, no confirm |
| 5 | resolve `matrix-bridge` + `task` + `write` | Strict, no confirm |
| 6 | resolve unknown actor + any URI | Strict (default fail-safe) |
| 7 | resolve dangerous (delete op) | Dangerous, requires confirm |
| 8 | POSTURE_TABLE has 3 entries for the 3 Posture values | map contains Strict/Auto/Dangerous |
| 9 | appendAuditRecord writes JSONL line | file size grows |
| 10 | readAuditRecords parses JSONL back | array matches |
| 11 | audit record schema has ts/actor/uri/op/posture/result | all fields present |
| 12 | audit record result=fail has error field | error non-empty |

## 7. Acceptance

- 12+ test cases pass
- 87/87 existing + Slice 1's 24 + Slice 2's 12+ = **123+/123+** pass
- npm run build 0 errors
- lib/posture-middleware.js + lib/audit-trail.js + .d.ts generated

## 8. Self-Review

- ✅ No placeholder
- ✅ No contradiction (5.x §1 and §6 aligned)
- ✅ Scope focused (2 files + 1 test file)
- ✅ Boundary explicit (posture = decision, ACL = enforcement in Slice 3)
- ✅ ADR signal in spec-slice-1 already covers posture resolution direction

Proceed to implementation (per turn 20 user "总工决策, 不要问我" + turn 21 "继续").
