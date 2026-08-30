# Progress

| Slice | Status |
|---|---|
| Planning and architecture lock | done |
| Boundary TDD | done |
| Matrix audio | done |
| Windows SAPI | done |
| Governed voice event/outbox poll | done |
| Node-b DSH plugin upgrade | done: 0.2.1 installed, restarted, HTTP/Matrix verified |
| npm publication | done: 0.2.1 published as `latest` |
| Remote Core rollout | done: e5b6e16 built/restarted; new routes authenticated 200 |
| Protected Matrix provisioning | pending: dedicated identities/E2EE store |

Verification: `npm test` = 212/212; local real SAPI WAV = 145730 bytes,
3303 ms. Node-b now runs `dsh-matrix-connector@0.2.1`; DSH returned HTTP 200
and Matrix `whoami` confirmed the configured user/device after restart. The stale
profile patch binding for 0.1.4 was removed because its lifecycle fix is upstream
and its memory-only crypto change is explicitly superseded by 0.2.1. The package
is now installed from the npm registry (not a temporary tarball). Remote Core
v0.2 routes return authenticated 200. Dedicated Life, Health, and Companion
provisioning remains gated because public registration is disabled.
