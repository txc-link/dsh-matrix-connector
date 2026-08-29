# R-C-2 Task title → matrix room name 投影 (2026-08-30)

## 1. 目标

matrix adapter 创建 task room 时用 Task title 命名房间，让人类用户在 matrix 客户端能直观看到任务名。

这是 R-C (T-1.5 thread↔task binding) 的 matrix side 收口:
- R-C-1 (dsh-agora PR#12): threadTaskBindingService — Core 持有 opaque threadKey↔taskId
- **R-C-2 (本 PR, dsh-matrix-connector)**: adapter 创建 room 时投影 Task title → room name

## 2. 范围

### 必须
1. `src/room-name.ts` — 纯函数 `buildRoomName(taskTitle, taskId?)`:
   - matrix room name ≤ 255 chars
   - 清洗控制字符 / null / 全空白
   - 可选 `[taskId] ` 前缀 (可辨识)
2. `src/room-provisioner.ts` — `provisionTaskRoom({ client, agora, taskId })`:
   - agora.getTask(taskId) → title
   - buildRoomName(title, taskId)
   - client.createRoom({ name })
   - 返回 { roomId, roomName }
3. `tests/room-name.test.mjs` — 纯函数单测 (长度/清洗/前缀/中文)
4. `tests/room-provisioner.test.mjs` — 集成单测 (stub agora + stub client)
5. `src/index.ts` export
6. `Doc/09-PLANNING/TASKS/2026-08-30-rc2-roomname-projection/{task_plan,findings,progress}.md`

### 不做 (后续段)
- ❌ 已有 room 的 rename (setName) — R-C-2 只覆盖创建路径
- ❌ Space 嵌套 (R-E)
- ❌ appservice 模式 — bot transport 够用

## 3. 设计

```ts
// src/room-name.ts
export function buildRoomName(taskTitle: string, taskId?: string): string {
  // strip control chars, collapse whitespace, cap 255
  // prefix `[<taskId>] ` if provided and fits
}

// src/room-provisioner.ts
export async function provisionTaskRoom(opts: {
  client: Pick<MatrixClient, 'createRoom'>;
  agora: Pick<AgoraRestClient, 'getTask'>;
  taskId: string;
}): Promise<{ roomId: string; roomName: string }>
```

## 4. worktree

- path: `.repos/wt-rc2-roomname/`
- branch: `feat/rc2-roomname-projection` (base main `6ae3d0b`)

## 5. 验证

- node --test: room-name + room-provisioner suites pass
- npm run build: 0
- 真实 homeserver smoke: agent-hub.local:8008 (可选, 沙箱内可能不可行)