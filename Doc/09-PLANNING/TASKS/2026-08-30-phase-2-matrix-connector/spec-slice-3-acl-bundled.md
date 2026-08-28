# Spec Brief — Slice 3 (ACL Bundled)

**Spec ID**: `2026-08-30-slice-3-acl-bundled`
**Date**: 2026-08-29 (Asia/Shanghai)
**Owner**: 总工
**Related SSoT**: [Doc/Agora-实施排期-dsh-matrix-connector.md §5 + §6 Slice 3](../../../../Agora-实施排期-dsh-matrix-connector.md#5-acl-bundled-u4a-实施)
**Related task_plan**: [task_plan.md §4 Slice 3 Plan](../../../../Doc/09-PLANNING/TASKS/2026-08-30-phase-2-matrix-connector/task_plan.md)

---

## 1. Outcome

One pure module: `src/acl-bundled.ts`.

Defines the bundled ACL table (per U4=A decision) and a check function that returns
allow/deny based on (actor, uri, op).

**No IO. Pure function over a static table.**

## 2. Why

- Slice 3 = U4=A implementation
- ACL = "is this actor allowed to do this op on this URI type?"
- Bundled = static table shipped in code (not loaded from Core)
- Slice 2 posture middleware uses Slice 1 URI; Slice 3 ACL provides the **enforcement** layer

## 3. Non-goals

- ❌ No remote ACL (Core ACL separate; this is adapter-local)
- ❌ No dynamic ACL reload (bundled = static at compile time)
- ❌ No actor auth (auth happens in dsh-agora; here just check the identity)
- ❌ No audit trail integration (Slice 2 audit-trail handles that)
- ❌ No per-URI scope (URI-level granularity is out of scope; type-level only)

## 4. Public API Surface

```typescript
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

/**
 * Bundled ACL table: actor → list of allowed (type, op) tuples.
 * Plus optional sub-path scope (e.g., postmortem only).
 */
export const ACL_TABLE: ReadonlyMap<string, ReadonlyArray<{
  type: string;            // 'task' | 'event' | 'participant' | 'execution' | '*'
  op: Op | '*';            // 'read' | 'write' | 'delete' | 'execute' | '*'
  sub?: string;            // optional sub-path scope
}>>;

export function checkAcl(ctx: AclCheckContext): AclDecision_;
```

## 5. ACL Table Entries

```typescript
ACL_TABLE = Map {
  'human:dashboard'         → [{ type: '*', op: '*' }]                              // 全权限
  'agent:claude-code'       → [
    { type: 'task',        op: 'read' },
    { type: 'task',        op: 'write' },
    { type: 'task',        op: 'execute' },
    { type: 'event',       op: '*' },
    { type: 'participant', op: 'read' },
    { type: 'execution',   op: 'read' },
  ],
  'agent:matrix-bridge'     → [
    { type: 'event', op: 'read' },                                                // 只读事件
  ],
  'agent:postmortem-bot'    → [
    { type: 'task', op: 'read', sub: 'postmortem' },                              // 限定 postmortem sub
  ],
}
```

## 6. Test Coverage (10+ cases)

| # | Test | Expected |
|---|---|---|
| 1 | dashboard + any URI + any op | allow |
| 2 | claude-code + task + read | allow |
| 3 | claude-code + task + delete | deny |
| 4 | claude-code + event + read | allow |
| 5 | claude-code + event + write | allow |
| 6 | matrix-bridge + event + read | allow |
| 7 | matrix-bridge + task + write | deny |
| 8 | matrix-bridge + task + read | deny |
| 9 | postmortem-bot + task + read (sub=postmortem) | allow |
| 10 | postmortem-bot + task + read (no sub) | deny |
| 11 | unknown actor | deny |
| 12 | ACL_TABLE has at least 4 entries | map.size >= 4 |

## 7. Acceptance

- 12+ test cases pass
- 126 + 12+ = **138+/138+** pass total
- npm run build 0 errors
- lib/acl-bundled.js + .d.ts generated

## 8. Self-Review

- ✅ No placeholder
- ✅ No contradiction (5.x §1 and §6 aligned)
- ✅ Scope focused (1 file + 1 test file)
- ✅ Boundary explicit (ACL = adapter-local bundled table; Core ACL separate)
- ✅ Integrates with Slice 1 (AgoraUri) and Slice 2 (Op) without coupling

Proceed to implementation (per turn 20 "总工决策" + turn 21 "继续").
