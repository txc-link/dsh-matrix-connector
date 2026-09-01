# 任务计划：Matrix 点名唤醒与协同轮次

## 工作树

- `E:\Learn AI Agent\dsh-matrix-connector\.worktrees\phase-routine-runner-collab-memory`
- 分支：`feat/phase-routine-runner-collab-memory`

## 范围

- 保留 Connector 为 Matrix ↔ Agora REST adapter；
- 增加显式角色点名解析、协同轮次/冷却约束和可审计元数据；
- 不把多 Agent 编排逻辑复制到 Connector；
- 和 Agora Core 的 conversation/coordination API 保持松耦合。

## 验收

- 普通人类消息不自动广播给所有 Agent；
- `@role` 或明确 `/agora task ...` 才能生成唤醒意图；
- bot 回复在冷却/轮次/重复事件规则下不会无限互相触发；
- 原有命令和 292 项回归保持通过。
