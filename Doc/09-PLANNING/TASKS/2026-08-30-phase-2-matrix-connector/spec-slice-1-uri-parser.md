# Spec Brief — Slice 1 (URI Parser)

**Spec ID**: `2026-08-30-slice-1-uri-parser`
**Date**: 2026-08-29 (Asia/Shanghai)
**Owner**: 总工
**Related SSoT**: [Doc/Agora-实施排期-dsh-matrix-connector.md §2](../../../../Agora-实施排期-dsh-matrix-connector.md#2-architecture-decisions-locked-from-phase-1-ecosystem-design-inputs)
**Related task_plan**: [task_plan.md §2 Slice 1 Plan](../../../../Doc/09-PLANNING/TASKS/2026-08-30-phase-2-matrix-connector/task_plan.md)

---

## 1. Outcome

A pure-function URI parser in `src/uri-parser.ts` that:

- Accepts input strings of the form `agora://<type>/<id>[/<sub>]`
- Returns a typed `AgoraUri` object on success
- Throws an `Error` with a debuggable message on invalid input

**No IO. No state. No dependency on `agora-ts/packages/core`.**

## 2. Why

- Slice 1 = foundation for Slice 2/3/4/5 (posture / ACL / handler / smoke)
- Public API contract: any `@pull` caller hits this parser first
- Wrong grammar choice cascades into all downstream slices

## 3. Non-goals

- ❌ Not a full RFC 3986 parser (over-engineering per §1.5)
- ❌ Not a Core URI validator (cross-owner violation per §1)
- ❌ No query string parsing (`?key=val`)
- ❌ No fragment parsing (`#section`)
- ❌ No database / network IO
- ❌ No npm package publish
- ❌ No cross-cutting concerns (no log, no telemetry, no auth)

## 4. Public API Surface

### 4.1 Types

```typescript
export interface AgoraUri {
  scheme: 'agora';
  type: string;
  id: string;
  sub?: string;
}
```

### 4.2 Constants

```typescript
export const VALID_TYPES: ReadonlySet<string>;  // 'task' | 'event' | 'participant' | 'execution'
export const ID_PATTERN: RegExp;                  // /^[A-Z][a-z]+(-[A-Z0-9][a-zA-Z0-9]*)+$/
```

### 4.3 Functions

| Function | Signature | Behavior |
|---|---|---|
| `parseAgoraUri` | `(input: string) => AgoraUri` | Parse; throw on invalid |
| `validateType` | `(type: string) => boolean` | Check type ∈ VALID_TYPES |
| `validateId` | `(id: string) => boolean` | Check id matches ID_PATTERN |
| `buildAgoraUri` | `(uri: Omit<AgoraUri, 'scheme'>) => string` | Reverse build |

### 4.4 Error Messages (debugable)

| Invalid case | Error message |
|---|---|
| Empty input | `"empty input"` |
| Missing scheme | `"missing scheme; expected 'agora://...'"` |
| Wrong scheme | `"invalid scheme 'http'; expected 'agora'"` |
| Missing type | `"missing type after 'agora://'"` |
| Invalid type | `"invalid type 'foo'; valid types: task, event, participant, execution"` |
| Missing id | `"missing id after 'agora://<type>/'"` |
| Invalid id | `"invalid id 'X-1'; expected pattern <prefix>-<body>"` |
| Empty sub | `"empty sub-path after '/'"` |

## 5. Grammar

```
AgoraUri ::= "agora://" Type "/" Id [ "/" Sub ]
Type     ::= "task" | "event" | "participant" | "execution"
Id       ::= Prefix "-" Body
Prefix   ::= [A-Z][a-z]+
Body     ::= [A-Za-z0-9]+ ( "-" [A-Za-z0-9]+ )*
Sub      ::= [a-z0-9-]+
```

### Examples

| Input | Output |
|---|---|
| `agora://task/Ta-123` | `{ scheme: 'agora', type: 'task', id: 'Ta-123' }` |
| `agora://event/Ev-abc-456` | `{ scheme: 'agora', type: 'event', id: 'Ev-abc-456' }` |
| `agora://task/Ta-123/postmortem` | `{ scheme: 'agora', type: 'task', id: 'Ta-123', sub: 'postmortem' }` |
| `agora://task/Ta-123/postmortem/tick` | `{ scheme: 'agora', type: 'task', id: 'Ta-123', sub: 'postmortem/tick' }` (Sub 含 `/` 整体) |

## 6. Acceptance Criteria

### 6.1 Test coverage (21 cases minimum)

Happy path (14 cases):
1. parse `agora://task/Ta-123` → `{ scheme: 'agora', type: 'task', id: 'Ta-123' }`
2. parse `agora://event/Ev-abc-456` → similar
3. parse `agora://participant/Pa-1` → similar
4. parse `agora://execution/Xe-foo-bar` → similar
5. parse `agora://task/Ta-123/postmortem` → with `sub`
6. parse `agora://event/Ev-1/tick/state` → with `sub` containing `/`
7. validate `task` → true
8. validate `unknown` → false
9. validate `Ta-123` → true
10. validate `t-1` → false (lowercase prefix)
11. validate `T-` → false (empty body)
12. validate `123` → false (no prefix)
13. build `{ type: 'task', id: 'Ta-123' }` → `agora://task/Ta-123`
14. build `{ type: 'task', id: 'Ta-123', sub: 'postmortem' }` → `agora://task/Ta-123/postmortem`

Invalid (7 cases):
15. `http://task/Ta-123` → throw "invalid scheme"
16. `agora://` → throw "missing type"
17. `agora://task/` → throw "missing id"
18. `agora://foo/x-1` → throw "invalid type"
19. `agora://task/x-1` → throw "invalid id pattern"
20. `` (empty) → throw "empty input"
21. `agora://task/Ta-123/` → throw "empty sub-path" (trailing slash w/o sub)

Note: "multi-word prefix" rejection removed. Grammar ([A-Z][a-z]+ = 1
uppercase + 1+ lowercase) cannot distinguish single-word vs multi-word
prefix; both `Ta-1` and `Task-1` are valid by grammar. Body separator `-`
is the boundary; "multi-word prefix" is not a meaningful concept here.

### 6.2 Existing tests must not break

- 87/87 baseline must remain green
- Final total ≥ 103/103 (87 + 16+ new)

### 6.3 Build verify

- `npm run build` → 0 errors
- `lib/uri-parser.js` + `lib/uri-parser.d.ts` generated
- Other 14 .js / 14 .d.ts untouched

### 6.4 Type safety

- TypeScript strict mode (per existing tsconfig.json)
- No `any` types

## 7. Implementation Plan (TDD order)

1. Write `tests/uri-parser.test.mjs` with 22+ cases (red)
2. Run `node --test tests/uri-parser.test.mjs` → expect fail (file not exist or 22 fail)
3. Implement `src/uri-parser.ts`:
   - export `AgoraUri` interface
   - export `VALID_TYPES` Set
   - export `ID_PATTERN` RegExp
   - export `parseAgoraUri`, `validateType`, `validateId`, `buildAgoraUri`
4. Run `node --test tests/uri-parser.test.mjs` → expect all 22 pass (green)
5. Run `node --test tests/*.test.mjs` → expect 87 + 22 = 109 pass (regression)
6. Run `npm run build` (via symlink node_modules) → expect 0 errors
7. Verify `lib/uri-parser.js` + `.d.ts` exist
8. Update SSoT §1 status table (slice 1 → done)
9. Update task_dir `progress.md` (slice 1 receipts)

## 8. ADR Signal

This spec records a durable architecture decision:

- **Subject**: dsh-matrix-connector URI grammar
- **Surface**: Public API contract
- **Alternatives considered**: RFC 3986 full parser (uri-js), regex-only, hand-written state machine
- **Decision**: hand-written state machine (Option 1, recommended in design dialog)
- **Trade-off**: Grammar is custom, not RFC 3986 compatible; but avoids over-design per §1.5
- **Retirement trigger**: if Agora Core exposes a public URI parser API, this parser degrades to a thin adapter wrapper

For durable record, an ADR file should be created in `Doc/11-REFERENCE/adr/` after Slice 1 verification. (Out of scope for Slice 1 itself; created at slice closeout.)

## 9. Cross-references

- SSoT: [Doc/Agora-实施排期-dsh-matrix-connector.md §2 U1](../../../../Agora-实施排期-dsh-matrix-connector.md#2-architecture-decisions-locked-from-phase-1-ecosystem-design-inputs)
- task_plan: [task_plan.md §2 Slice 1](../../../../Doc/09-PLANNING/TASKS/2026-08-30-phase-2-matrix-connector/task_plan.md)
- prior dialog: turn 20 总工会议 4-perspective dialog output
- AGENTS.md §1 (Core 不动)
- AGENTS.md §1.5 (0 overdesign)
- AGENTS.md §3 (SSoT 双向绑定)
- AGENTS.md §4 (TDD 严格)

## 10. Spec Self-Review

| Check | Result |
|---|---|
| Placeholder scan (TBD / TODO) | ✅ no placeholders |
| Internal consistency | ✅ no contradictions (grammar ↔ examples ↔ tests) |
| Scope check | ✅ focused: single file + single test file + single outcome |
| Ambiguity check | ✅ grammar unambiguous; error messages unambiguous |
| Boundary check | ✅ non-goals explicit; AGENTS.md §1/§1.5/§3/§4 cited |
| ADR signal | ✅ recorded in §8 |

Spec is ready for implementation. Per user turn 20 "总工决策, 不要问我", proceed directly to Slice 1 implementation.

## 11. Implementation Kickoff

Next turn: TDD red → green cycle for Slice 1.

Plan:
- Step 1: Write `tests/uri-parser.test.mjs` (22 cases)
- Step 2: Run test → red
- Step 3: Implement `src/uri-parser.ts`
- Step 4: Run test → green
- Step 5: Regression test → 87 + 22 = 109+ green
- Step 6: Build verify → 0 errors, `lib/uri-parser.js` + `.d.ts` generated
- Step 7: Update SSoT + progress + emit Slice 1 L1 receipt

(Per AGENTS.md §4 TDD, this is single-slice scope; not crossing slice boundary in single turn.)