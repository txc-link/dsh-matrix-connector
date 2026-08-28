# Agora Core Decoupling Standard (DSH-Matrix-Connector Reference)

## Purpose
This document captures how dsh-matrix-connector (an IM entry adapter) must
remain decoupled from `Agora Core` semantics. It exists in this repo as a
**reference pointer** for Phase 2 contributors, with the authoritative
copy living in `Agora_Private/docs/11-REFERENCE/`.

## Three-Layer Model (per AGENTS.md §1)

### Upper Layer — IM / Channel / Entry Adapters
- dsh-matrix-connector lives here
- Speaks Matrix protocol (homeserver + room) on one side
- Speaks agora central REST on the other side
- Maintains opaque `threadKey` mapping between rooms and tasks
- Other upper-layer adapters: Discord / Feishu / Slack / Dashboard / CLI / REST

### Middle Layer — Agora Core / Orchestrator
- Task / Context / Participant / RuntimeBinding / Execution / Event / Notification
- State machine / Gate / Scheduler / Recovery / Archive
- **Source of truth for orchestration semantics**

### Lower Layer — Agent Runtime / Host Adapters
- Craftsman / Execution Engine adapters

## Hard Constraints (per AGENTS.md §1)

- dsh-matrix-connector **must not** modify `packages/core`
- provider-specific data (Matrix room IDs, MXIDs, events) lives only as
  adapter state or projection, never as long-term Core model
- Agora Core consumes unified actor/permission semantics; it does not
  know whether the trigger came from Matrix or Dashboard

## Phase 2 Implications

When implementing Phase 2 (matrix-connector @pull + three posture governance),
all Matrix-specific event shapes must:

1. Be normalized at the adapter boundary (the matrix plugin)
2. Be exposed as semantic Agora Core events (`TaskCreated`, `ExecutionStateChanged`,
   `ParticipantJoined`, etc.)
3. Never bypass Core to mutate state directly

## Authoritative Source

The authoritative version of this standard lives in:
`Agora_Private/docs/11-REFERENCE/agora-core-decoupling-standard.md`

For Phase 2 reference only. When in doubt, defer to the Agora_Private copy.
