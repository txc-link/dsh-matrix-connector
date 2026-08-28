# Spec Brief — Slice 4 (@pull Handler)

**Spec ID**: `2026-08-30-slice-4-pull-handler`
**Date**: 2026-08-29 (Asia/Shanghai)
**Owner**: 总工
**Related SSoT**: [Doc/Agora-实施排期-dsh-matrix-connector.md §6 Slice 4](../../../../Agora-实施排期-dsh-matrix-connector.md#slice-4--pull-command-handler)
**Related task_plan**: [task_plan.md §5 Slice 4 Plan](../../../../Doc/09-PLANNING/TASKS/2026-08-30-phase-2-matrix-connector/task_plan.md)

---

## 1. Outcome

One module: `src/pull-handler.ts`.

Composes Slice 1 (URI parser) + Slice 2 (posture middleware + audit trail) +
Slice 3 (ACL bundled) into a single @pull command handler.

**No IO outside audit trail append.**

## 2. Public API Surface

```typescript
export interface PullRequest {
  actor: string;             // e.g. "agent:matrix-bridge"
  op: Op;                    // 'read' | 'write' | 'delete' | 'execute'
  uri: string;               // raw string form
}

export interface PullResponse {
  status: 'executed' | 'denied' | 'requires_confirm' | 'error';
  parsed?: AgoraUri;
  posture?: PostureDecision;
  acl?: AclDecision_;
  audit?: AuditRecord;
  error?: string;
}

export function handlePull(req: PullRequest): PullResponse;
```

## 3. Flow

1. Parse URI (Slice 1) → if parse fails → `status: 'error'`, audit fail
2. Check ACL (Slice 3) → if deny → `status: 'denied'`, audit fail
3. Resolve posture (Slice 2) → returns posture decision
4. If posture === Dangerous → `status: 'requires_confirm'` (caller must re-call with confirm: true)
5. Otherwise → `status: 'executed'` (in real impl, this would dispatch to Agora Core; in Slice 4 we just audit)

## 4. Test Coverage (8+ cases)

| # | Test | Expected status |
|---|---|---|
| 1 | dashboard + delete + valid task URI | requires_confirm (Dangerous posture) |
| 2 | dashboard + read + valid task URI | executed |
| 3 | claude-code + read + task URI | executed (Auto) |
| 4 | matrix-bridge + write + task URI | denied (ACL) |
| 5 | matrix-bridge + read + event URI | executed (Auto) |
| 6 | invalid URI string | error |
| 7 | unknown actor + read | denied |
| 8 | audit record written for executed | audit ts set |

## 5. Acceptance

- 8+ test cases pass
- 138 + 8+ = **146+/146+** pass total
- npm run build 0 errors
- lib/pull-handler.js + .d.ts generated

Proceed to implementation per turn 21 "继续".
