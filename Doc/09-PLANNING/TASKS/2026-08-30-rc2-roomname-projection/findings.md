# R-C-2 Findings — Task title → matrix room name (2026-08-30)

## 1. 设计决策

### 1.1 §1 boundary — adapter-side 投影

Task title → room name 是**纯 matrix adapter 职责**：
- agora Core 不知道 room name 存在（只存 opaque threadKey↔taskId，R-C-1 PR#12）
- room name 是 matrix 投影，由 dsh-matrix-connector 的 `buildRoomName` 纯函数承担
- agora 只通过 REST `getTask(taskId)` 提供 title 源数据

移除 matrix 后 buildRoomName 无意义（它是 adapter 内部 helper），但 agora Core 完全不受影响 —— §1 合规。

### 1.2 纯函数拆分

`buildRoomName(taskTitle, taskId?)` 是纯函数（无 I/O）：
- 清洗控制字符（\u0000-\u001f / \u007f → 空格）
- 折叠空白（\s+ → 单空格）
- trim
- 空标题 → 'untitled-task' fallback
- 可选 `[<taskId>] ` 前缀（识别用）
- 总长 ≤ 255（matrix room name 上限）

`provisionTaskRoom({ client, agora, taskId })` 编排：
1. agora.getTask(taskId) → title（失败抛错，不建房间）
2. buildRoomName(title, taskId)
3. client.createRoom({ name })
4. 返回 { roomId, roomName }

### 1.3 为什么不在 matrix-client 内建

matrix-client.createRoom 是通用房间创建；title→name 是**任务语义投影**。
分层：通用 transport/client 保持通用，任务投影在 provisioner 层组合 —— 符合 §1 可插拔。

## 2. 测试覆盖

| suite | tests | 覆盖 |
|---|---|---|
| room-name.test.mjs | 7 | 透传/前缀/控制字符/空白/255 截断/空标题/前缀预算 |
| room-provisioner.test.mjs | 3 | 命名投影/错误传播/matrix-safe |

## 3. 未决 (后续段)

- ❌ 已有 room 的 rename (m.room.name state event) — R-C-2 只覆盖创建路径；Task title 变更后的 room rename 留给后续
- ❌ Space 嵌套 (R-E)
- ❌ real homeserver smoke — 沙箱内无 homeserver 访问（agent-hub.local 在用户服务器），留给 dev machine