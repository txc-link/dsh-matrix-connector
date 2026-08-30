# Company OS v0.1 Matrix entry

## Goal

Expose the durable Organization / Employment / Executive Assistant vertical
slice from `dsh-agora` through Matrix without moving policy or organization
state into the adapter.

## SSoT

- `Doc/Agora-实施排期-dsh-matrix-connector.md`
- Sibling Core task:
  `dsh-agora-company-v01/Doc/09-PLANNING/TASKS/2026-08-30-company-os-v01/`

## Slices

1. Add typed REST client methods for organization snapshots and EA inboxes.
2. Add thin `company` and `assistant` bridges and command routing.
3. Add optional default organization binding for a connector instance.
4. Verify tests/build, update SSoT/walkthrough, publish, and deploy node-b.

## Locked decisions

- Organization, employment, routing, and commitment state remain in Core.
- Matrix is a projection and command adapter only.
- Company, Life, Health, and Companion are independent security-domain roots;
  this slice exposes Company only.
- The configured default organization is an opaque id/slug, not adapter-owned
  organization state.
