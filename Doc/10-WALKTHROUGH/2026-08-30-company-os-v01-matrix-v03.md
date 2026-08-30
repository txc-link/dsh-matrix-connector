# Company OS v0.1 Matrix walkthrough (connector 0.3.0)

## Outcome

Matrix now exposes the durable Company and Executive Assistant vertical slice
without becoming the system of record. Connector 0.3.0 is installed and
running on node-b; organization, employment, task routing, and commitment state
remain in dsh-agora Core.

## Commands

```text
/agora company
/agora company list
/agora company show [organization]

/agora assistant ask [--org <id-or-slug>]
  [--capability <capability>] [--type <task-type>]
  [--priority <priority>] [--due <iso-time>]
  [--target <position-or-subject>] <request>
/agora assistant inbox [status]
/agora assistant commitments [status]
/agora assistant show <request-id>
/agora assistant reconcile <request-id> [evidence-ref...]
```

node-b configures `companyOrganization: austin-agent-company`, so the owner
normally omits `--org`. The Matrix sender is retained as `requestedBy`.

## Runtime flow

```text
Matrix command
  -> CompanyBridge / ExecutiveAssistantBridge
  -> authenticated dsh-agora REST API
  -> Core organization + routing policy
  -> project execution Team + TaskClaim
  -> Commitment ledger
  -> Matrix response projection
```

The adapter cannot invent organization membership or route around Core. For an
assigned request, Core first maps the task template roles to the employed
runtime target and then writes the claim. This keeps the execution team and
claim owner consistent.

## Verification

- Connector typecheck and production build: pass.
- Complete connector test suite: 225/225.
- Exact 0.3.0 package contents: npm pack dry-run pass.
- node-b DSH endpoint: HTTP 200 after restart.
- Matrix bot/device identity: verified with whoami.
- Core node-b heartbeat: current.
- Live research request: assigned to the formal Research Lead; task team and
  task claim both resolved to `dsh:node-c:default`.
- Core restart retained organization, employments, request, and commitment.

## Security-domain boundary

Company, Life, Health, and Companion are separate root security domains. This
Company command entry does not expose or project personal-domain data. A shared
EA may route work across domains only through explicit authorization; it does
not receive universal cross-domain read access merely because it is the EA.

## Release boundary

node-b runs 0.3.0 from the verified stable tarball at
`C:\Users\ZHZX\.dsh\packages\dsh-matrix-connector-0.3.0.tgz`.
Registry publication is still pending because npm returned `ENEEDAUTH` on both
available machines; `latest` therefore remains 0.2.1 until an authenticated
publisher session or token is supplied.
