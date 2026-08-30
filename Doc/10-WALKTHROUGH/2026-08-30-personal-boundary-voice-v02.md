# Walkthrough — Personal boundary + proactive Matrix voice v0.2

## Outcome

```text
RelationshipInitiative (Core, provider-neutral)
  -> lease claim by one domain-bound connector
  -> InformationPolicy / Consent authorization
  -> ActionRisk assessment / optional Human Gate
  -> local Windows SAPI WAV
  -> Matrix media upload + m.audio
  -> delivered/failed lease acknowledgement
```

## Negative paths verified

- Company-domain content cannot enter a Companion/Life/Health connector.
- Unknown rooms are rejected before Core or TTS receives message text.
- Denied consent and Human Gate decisions stop synthesis and upload.
- Personal root Space with any `m.space.parent` link fails startup.
- One Matrix bot identity cannot pass strict deployment validation for two domains.
- Expired leases can be reclaimed after restart; delivered rows are not reclaimed.

## Provider boundary

Core stores `delivery_binding_ref`, never `room_id`. Connector config maps the
binding to a Matrix room. Persona voice preference is portable; the concrete
SAPI voice name is adapter configuration.

## Verification

- TypeScript build: pass.
- Connector tests: 212/212 pass.
- Real SAPI: Chinese WAV generated locally (145730 bytes, 3303 ms).
- Node-b: `dsh-matrix-connector@0.2.1` installed in the DSH `web` profile;
  restarted DSH listens on `127.0.0.1:3080` (HTTP 200), and Matrix `whoami`
  confirms the configured bot user and device. The restarted sync no longer
  reports the duplicate one-time-key failure.
- Remote: Agora health ok; Synapse Matrix v1.12 reachable.
- Deployment pending: remote Core routes are 404 and Synapse registration is
  disabled (403 for the dedicated Life, Health, and Companion users); SSH and
  Synapse admin provisioning are required before protected Spaces are created.
- Restart regression: v0.2.0 exposed duplicate one-time-key uploads from the
  memory-only Rust crypto store. v0.2.1 disables that unsafe initialization;
  encrypted protected rooms stay blocked until a durable store is available.
