# 2026-08-31 next batch — dsh-matrix-connector

> **Date**: 2026-08-31 (Asia/Shanghai)
> **Owner**: connector (matrix-connector)
> **Branch / worktree**: `feat/2026-08-31-next-batch` @ `/home/ailink/dsh-matrix-connector/.worktrees/next-batch`
> **Trigger**: 用户 turn 1 — "更新 dsh-agora 和 dsh-matrix-connector, 拉取新代码, 然后继续 [六个缺口]"
> **Authority**: Doc/03-ARCHITECTURE/2026-08-30-expert-team/{01..04} 裁决 + AGENTS.md §1/§3

## 0. 范围 (in / out)

### In (本批交付, TDD)
| Slice | 范围 | 对应缺口 | 验收 |
|---|---|---|---|
| **V_proactive** | connector: `GovernedVoiceDelivery` 解除 companion-only 闸; 新增 `speech.domains` 白名单 (company/work/health/life 逐域配置); 新增 `/agora say <text>` slash 作为显式触发; natural-chat 在 voice=true 且 domain ∈ speech.domains 时投递 m.audio | #2 Agent 语音消息 | 单测: 非 companion 域在 speech.domains 包含时投递, 否则不发; `/agora say` 走同一投递路径; 回归 276+ |
| **C_slash** | connector: 新增 `/agora calendar today|conflicts|morning|evening` 与 `/agora doc show|edit <artifactId>` 与 `/agora call join [roomId]`; 委托到 agora REST 与新 service | #3 #5 #6 命令面 | 路由单测: 已知 verb 分发正确, 未知 verb 返回 help |
| **EC_light** | connector: 在 spaces/rooms provisioner 加 Element Call widget 房间模板; `roomCallRegistry` 写 m.widget 状态事件 (MSC3401/3898); `/agora call join` 触发 widget URL + LiveKit JWT 占位 (实际 SFU 由用户部署) | #6 Element Call (P2 轻量, 严格按裁决 §3 仅 enablement) | 房间创建后 widget URL 生效; 占位 JWT 生成不阻塞 |
| **B_pre** | baseline: 拉取与构建验证, 0.5.2 fix 合入 main 后 276/276 绿 | "更新" | done |

### Out (hand off, 不在本批做)
- 完整 Element Call SFU + TURN 部署 (verdict §3 P2, 部署量大, 需用户单独拍板)
- 语音 GPU 显存调度与空闲卸载 (verdict §3 V4, 已在 0.4.0 串行队列+超时基础上留 follow-up)
- 协作文档 CRDT/多人实时 (verdict §3 列为 P1, v0.1 单写者)
- Grafana 完整 dashboard 抛光 + alert 策略 (本批只给 relay + JSON 框架)
- Agora Core 大改 (AGENTS.md §1; 严守 "agora-ts 不主动大改" SSoT 原则)

## 1. 依赖与接线

- agora-ts 端 (feat/2026-08-31-next-batch 仓) 并行:
  - `POST /api/tasks/:id/subtasks` (breakdown)
  - `POST /api/tasks/:id/transfer` (转派, Dashboard 审批闸)
  - `GET  /api/approvals/pending` + `POST /api/approvals/:id/decide` (A4 Human Gate)
  - `GET  /api/calendar/{today,conflicts}?domain=work|life` + `POST /api/calendar/reports/{morning,evening}`
  - `GET  /api/artifacts/:id/markdown` + `POST /api/artifacts/:id/markdown` (versioned, single-writer)
- connector 本批不直接改 Core; 只新增 slash + 委托 REST; voice 投递走既有 GovernedVoiceDelivery + matrix.sendAudio

## 2. TDD 顺序

1. V_proactive 单测先写 (governed-voice + speech-config + slash say) → 实现 → 276+ 回归
2. C_slash 路由单测 → 实现 (calendar/doc/call verb 注册) → 回归
3. EC_light 单测 (call widget 状态事件 + URL) → 实现 → 回归
4. 三组一起 `npm test` + `npm run typecheck` 全绿 → commit

## 3. 验证 (verify-before-completion)
- `npm test` 全部通过
- `npm run typecheck` 0 error
- 手测脚本 (沙箱无 live Synapse 时跳过): 以 `npm run smoke:matrix -- --dry-run` 占位
- SSoT 与 walkthrough 回写

## 4. 不破坏的约束 (来自裁决/AGENTS.md)

- A1-A8 全部维持 (Core 不写死平台; Human Gate 唯一 = Dashboard)
- Phase 3 默认 (agora-ts 不主动大改; connector 本批新增为适配层)
- Speech 域授权遵循 personal-boundary-voice 已落地的 ConsentGrant / ActionRisk (companion 域闸保留并扩展为 domains 白名单)

## 5. 回写
- `docs/09-PLANNING/dsh-matrix-connector.md` (matrix SSoT)
- `docs/10-WALKTHROUGH/2026-08-31-next-batch.md`
- `package.json` version bump → 0.6.0 (新能力面, 增量 minor)