# Findings

- The existing connector already has a typed REST client and bridge pattern,
  so the company entry can be additive without touching Matrix transport.
- Existing `Team` commands are project-execution concepts; they must not be
  reused as the formal company organization model.
- The connector has no organization binding yet. An optional
  `companyOrganization` setting gives the owner a concise `/agora assistant`
  entry while commands can still accept an explicit organization id/slug.
- Personal-domain projection boundaries already exist and must remain separate
  from the Company command surface.
- Core task creation must bind every template role to the selected employed
  runtime before claiming work. The live acceptance proved both task-team and
  claim ownership resolve to the Research Lead runtime.
- Three current remote runtimes provide real resident targets: node-b for EA
  and knowledge stewardship, node-c for research, and ailink-web for
  engineering. Auditor stays vacant until an independent runtime is available.
- npm registry credentials are absent/expired on both build hosts. A verified
  0.3.0 tarball is therefore installed on node-b while registry `latest`
  remains 0.2.1.
