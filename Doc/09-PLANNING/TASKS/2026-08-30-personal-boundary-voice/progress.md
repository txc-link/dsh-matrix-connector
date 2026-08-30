# Progress

| Slice | Status |
|---|---|
| Planning and architecture lock | done |
| Boundary TDD | done |
| Matrix audio | done |
| Windows SAPI | done |
| Governed voice event/outbox poll | done |
| Node-b DSH plugin upgrade | done: 0.2.1 installed, restarted, HTTP/Matrix verified |
| Remote probe | partial: services reachable; deployment credentials missing |

Verification: `npm test` = 212/212; local real SAPI WAV = 145730 bytes,
3303 ms. Node-b now runs `dsh-matrix-connector@0.2.1`; DSH returned HTTP 200
and Matrix `whoami` confirmed the configured user/device after restart. The stale
profile patch binding for 0.1.4 was removed because its lifecycle fix is upstream
and its memory-only crypto change is explicitly superseded by 0.2.1. Remote Core
v0.2 routes remain undeployed (authenticated 404); dedicated Life, Health, and
Companion Matrix registrations return 403 because public registration is disabled.
