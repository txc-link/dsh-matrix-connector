# Findings — 2026-08-31 next batch (connector)

## F1. 0.5.2 合入 main (B_pre)
- fix/matrix-room-chat-context (71c01af) 是 0.5.1 (559e303) 的直接后继, ff-only merge 无冲突
- 合并后: 276/276 tests pass, typecheck clean, dist 重建成功
- workspace 内 `dsh-matrix-connector-0.5.2.tgz` 与新 main (0.5.2) 内容一致; 不再独立 repack, 改由本批新能力 (0.6.0) 在末尾 `npm pack`

## F2. Voice proactive 现状 (V_proactive 起点)
- `governed-voice.ts` 已实现 `deliver()`: synthesizer.synthesize → matrix.sendAudio (m.audio + mxc + info), 已有 securityBoundary 闸
- `index.ts:114` 仅在 `securityBoundary && opts.speechSynthesizer` 时构造 voiceDelivery → 只覆盖 companion/security-domain
- `config.ts` speech schema 当前只有 `enabled/provider/voiceName/referenceId/timeoutMs/rate`, 无 per-domain 配置
- `natural-chat.ts:158` 在 `config.voice && delivery.voiceDelivery && delivery.sourceDomain` 时投递; 但 voiceDelivery 当前对 company/work/health/life 域恒为 undefined
- **缺口**: 投递闸 = companion-only; Agent 在 company/EA/work 房间回复无法主动发语音
- **修复方向**: 把闸从 "companion-only" 改为 "domain ∈ speech.domains 白名单", 默认白名单 = [] (零行为变更, 需用户显式打开), 与 personal-boundary-voice 的 ConsentGrant 兼容

## F3. slash 路由表 (C_slash 起点)
- 现有路由在 `index.ts` 的 `route(input.body, ...)`; 已知 verb 列表需读 `message-router.ts` / `routeMessage` 实际注册点
- 新增 verb (calendar/doc/call) 必须与现有 namespace 不冲突; 选 `calendar.* / doc.* / call.*` 短形式

## F4. Element Call enablement (EC_light 起点)
- Element Call 是 Element Web v1.12 内置, 无需额外服务; 房间侧需 `m.widget` 状态事件 type=`im.vector.modular.widgets` + `io.element.call` (MSC3401/3898)
- LiveKit SFU 与 TURN 部署由用户决定; 本批只给 widget URL + 占位 JWT 生成
- 与 verdict §3 "P2 后置" 一致; 本批仅 enablement

## F5. 与 Agora Core 的边界
- 本批不触发 agora-ts 大改; 所有 REST 新增由 agora-ts 同步分支 (feat/2026-08-31-next-batch) 提供, connector 只消费
- 若 REST 尚未就绪, slash 端用 feature flag / NotImplementedError 显式失败 (不静默退化, 符合 §1.5)