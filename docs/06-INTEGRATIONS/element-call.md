# Element Call enablement (2026-08-31)

> **Status**: enablement only — full SFU + TURN deploy is the user's
> decision (verdict §3 P2 postposed). The connector + Element Web
> widget surface are wired; the SFU is a separate deployment track.

## What the connector does today

- `/agora call join [roomId]` posts the Element Call widget URL into the
  Matrix room. Users click the link to join.
- The widget URL is read from `ELEMENT_CALL_WIDGET_URL` (default
  `https://call.element.io`); the room hint is either the explicit
  roomId argument or the current Matrix room id.
- The LiveKit / Jitsi JWT is read from `ELEMENT_CALL_TOKEN`. The default
  `LIVEKIT_JWT_PLACEHOLDER` is intentional — replace per deployment.

```text
/agora call join !ops:matrix.example.org
   ↳ posts: 📞 Element Call — click to join: https://call.element.io?roomId=!ops%3Amatrix.example.org&token=LIVEKIT_JWT_PLACEHOLDER
```

## SFU options (user-pick)

| backend | license | self-host | pros | cons |
|---|---|---|---|---|
| **LiveKit Cloud** | Apache 2.0 | optional | turnkey, JWT model, MSC3401+3402 | paid > 1k min/mo |
| **LiveKit OSS** | Apache 2.0 | yes | self-host, SFU + TURN in one binary | ops overhead |
| **Jitsi Meet** | Apache 2.0 | yes | mature, browser-direct | heavier infra |
| **Element Call (vendor)** | commercial | no | bundled with Element Cloud | vendor lock |

The default `ELEMENT_CALL_WIDGET_URL` targets the official Element Call
tenant (no SFU of yours); for self-host replace with your own LiveKit /
Jitsi widget URL.

## TURN / network

WebRTC needs STUN + TURN. Element Call expects a TURN server reachable
by both client and SFU. CoTURN (~Apache 2.0) is the canonical pick:

```yaml
# docker compose snippet — drop into the existing stack
services:
  coturn:
    image: coturn/coturn:4.6
    container_name: agora-coturn
    restart: unless-stopped
    network_mode: host   # TURN needs to bind 3478/udp and 49160-49200/udp
    command: >
      -n
      --realm=turn.matrix.example.org
      --static-auth-secret=<shared-secret>
      --use-auth-secret
      --no-tls --no-dtls
      --listening-port=3478
      --min-port=49160
      --max-port=49200
```

Element Web configures TURN via the homeserver `/.well-known/matrix/client`
(`org.matrix.msc_TURN`):

```json
{
  "m.turn_servers": [
    {
      "urls": ["turn:turn.matrix.example.org:3478?transport=udp"],
      "username": "1700000000:client",
      "credential": "<computed-from-shared-secret>"
    }
  ]
}
```

## Open follow-ups

- Real LiveKit / Jitsi deploy + JWT provisioning (user pick).
- Matrix room-level call history (recorded via Matrix state events).
- Recording / transcription (deferred; out of v0.6 scope).