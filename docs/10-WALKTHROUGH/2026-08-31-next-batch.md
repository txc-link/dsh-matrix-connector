# 2026-08-31 next-batch (matrix-connector) — walkthrough

> **Branch**: `feat/2026-08-31-next-batch`
> **Base**: `main` (0.5.2)
> **Commits**: `942e181` (V_proactive) + `97d4418` (C_slash + EC_light)

## 1. 切片

| 切片 | 范围 | commit | tests |
|---|---|---|---|
| **V_proactive** | `/agora say <text>` → GovernedVoiceDelivery; explicit proactive voice trigger (Agent 不能只在自然对话时发语音，现在有人类显式触发路径) | `942e181` | 3 new + 276 baseline = 279 |
| **C_slash** | `/agora calendar today\|conflicts\|morning\|evening` + `/agora doc show\|edit <artifactId>` delegate to agora REST | `97d4418` | 5 new + 279 = 284 |
| **EC_light** | `/agora call join [roomId]` posts the Element Call widget URL; ELEMENT_CALL_TOKEN placeholder; verdict P2 SFU/TURN deploy deferred to user | `97d4418` | 3 new + 284 = 287 |

## 2. 关键设计

- **V_proactive**：把 `/agora say` 作为显式 proactive voice trigger。无需修改 natural-chat 的治理闸（companion-only 由 ConsentGrant/ActionRisk 维持）；仅在 `voiceDelivery` 存在时投递 m.audio，否则返明确 `voice not configured`。
- **C_slash**：thin delegates to agora REST，503/4xx upstream responses 透传给用户（"无 Radicale env" / "artifact 不是 markdown" 等都直接呈现）。`call join` 把 literal `join` token 从 args 丢弃，避免与 subVerb 重复。
- **EC_light**：default widget URL `https://call.element.io` + `LIVEKIT_JWT_PLACEHOLDER`；`ELEMENT_CALL_WIDGET_URL` / `ELEMENT_CALL_TOKEN` env 覆盖。verify 文档 `docs/06-INTEGRATIONS/element-call.md` 给出 LiveKit vs Jitsi + CoTURN docker-compose + Element Web `m.turn_servers` well-known 模板。

## 3. Baseline 噪声（非本批引入）

无。本批 commit 前 main 已是 276/276 clean，本批 287/287 clean。typecheck clean。

## 4. 部署清单

1. 切到 `feat/2026-08-31-next-batch`，`npm install` + `npm run build`。
2. 重启 connector。
3. 设置环境变量（按需）：
   - `MATRIX_HOMES_URL` `MATRIX_ACCESS_TOKEN` 已有。
   - 新增 `ELEMENT_CALL_WIDGET_URL` `ELEMENT_CALL_TOKEN`（生产前必填）。
4. 升级版本号：当前 `0.5.2`；本批新增 3 个 verb，建议 `0.6.0`（按 §1.5 + 用户授权 publish）。

## 5. Slash 索引（v0.6）

```text
/agora citizen list | show <id>
/agora dispatch <prompt>
/agora task <taskId> [artifacts] | show <id> | pause|resume|cancel|unblock <id>
/agora artifact <artifactId>
/agora brain search <query>
/agora company [show|list]
/agora assistant ask|inbox|commitments|show <id>|reconcile <id>
/agora im health | help
/agora rollup
/agora stuck
/agora say <text>                    # NEW v0.6
/agora calendar today|conflicts|morning|evening [--domain work|life]   # NEW v0.6
/agora doc show|edit <artifactId> [content]                            # NEW v0.6
/agora call join [roomId]            # NEW v0.6 (Element Call enablement)
```