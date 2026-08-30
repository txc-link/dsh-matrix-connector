# Personal security boundary + voice delivery

## Goal

Ship a provider-adapter slice that keeps Company, Life, Health, and Companion
projections in independent top-level Matrix Spaces, binds each connector
instance to exactly one security domain, and can deliver Core-authorized voice
messages.

## SSoT

- `Doc/Agora-实施排期-dsh-matrix-connector.md` §10
- Core governance contracts live in the sibling `dsh-agora` repository.

## Slices

1. Security-boundary contract and negative tests.
2. Standard Matrix `m.audio` upload/send support.
3. Windows SAPI speech adapter with argument-safe process invocation.
4. Core authorization client and governed companion voice event.
5. Real homeserver smoke, documentation, version, release verification.

## Locked decisions

- One connector instance is bound to one `securityDomain`.
- A protected boundary root must be a top-level Space.
- Company/Life/Health/Companion use separate bot identities in production.
- Matrix is a projection; Core remains the policy authority.
- Standard `m.audio` is the portable baseline; waveform metadata is optional.

