# Findings

- The previous `rootSpaces: string[]` model could aggregate unrelated Spaces
  through one identity and carried no security-domain binding.
- `buildConfig()` dropped the optional `spaces` block, so top-level `apply()`
  could not actually activate the documented Space configuration.
- The transport already supports arbitrary upload bytes but only emits text
  message content.
- Windows has local SAPI voices available; `ffmpeg` is absent. WAV is therefore
  the zero-secret local synthesis format for node-b.
- Existing Rust crypto initialization is in-memory and is not sufficient for
  production E2EE recovery. Dedicated identities and separate Spaces are part
  of this slice; durable E2EE key backup remains an explicit deployment gate.
- Live restart exposed the concrete failure mode: the same device id generated
  a new `signed_curve25519` one-time key at index 0 and Synapse rejected it.
  v0.2.1 therefore leaves E2EE disabled instead of pretending memory crypto is
  safe. Durable Node crypto-store support remains a hard protected-data gate.
