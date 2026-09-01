# Progress

## 2026-09-01

- 已建立独立 connector worktree。
- 已完成 source/router/natural-chat/reply-ingest 现状检查，待开始测试驱动实现。
- 已加入 `CollabTurnController`：显式 @role 点名、agent 普通消息不再递归唤醒、cooldown、最大轮次与 event 去重；已接入 top-level、timeline、Space child 消息路径。
- 已验证 `npm run build` 与 `npm test` 通过（295/295）。
