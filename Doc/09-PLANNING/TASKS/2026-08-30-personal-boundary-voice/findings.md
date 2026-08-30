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

