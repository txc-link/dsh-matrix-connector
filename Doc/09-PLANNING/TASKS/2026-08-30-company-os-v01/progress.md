# Progress: Company OS v0.1 Matrix entry

> 2026-08-30 · deployed to node-b

| Slice | Status | Evidence |
|---|---|---|
| Planning and boundary lock | done | Matrix remains an adapter; Company is the only domain exposed by this entry |
| REST client contract tests | done | Typed organization snapshot and assistant request/inbox/commitment methods |
| Company / assistant bridges | done | Thin bridges contain no durable organization or routing policy |
| Router and runtime wiring | done | `/agora company` and `/agora assistant ...`; sender propagated as `requestedBy` |
| Full verification and docs | done | typecheck/build pass; connector suite 225/225; walkthrough and SSoT updated |
| npm publication and node-b rollout | done* | node-b runs packed 0.3.0; registry publication awaits npm authentication |

## Deployment evidence

- Implementation commit: `0815aff`, fast-forwarded to `main`.
- Package and plugin manifest version: `0.3.0`.
- `npm pack --dry-run` verified the exact package contents.
- Stable tarball installed at
  `C:\Users\ZHZX\.dsh\packages\dsh-matrix-connector-0.3.0.tgz`.
- node-b profile binds `companyOrganization: austin-agent-company`.
- node-b restarted successfully: DSH HTTP 200, Matrix whoami matched the
  configured bot/device, and Core reported a fresh node heartbeat.
- Live EA acceptance request routed through Core to the Research Lead; task
  team and claim both bound `dsh:node-c:default`.
- Company, Life, Health, and Companion remain separate root security domains.

`*` npm `latest` is still 0.2.1 because both available hosts returned
`ENEEDAUTH`. A fresh `npm adduser` session or automation token is required;
the rollout did not depend on or falsely report a registry release.
