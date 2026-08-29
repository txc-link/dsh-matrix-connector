# R-C-2 Progress (2026-08-30)

## 状态

✅ **完成** — Task title → matrix room name 投影 (dsh-matrix-connector)

## 验证

- room-name.test.mjs: 7/7
- room-provisioner.test.mjs: 3/3
- 全量回归: 166/166 (node --test tests/*.test.mjs)
- build: 0
- typecheck: 0

## 变更

| 文件 | 角色 |
|---|---|
| `src/room-name.ts` | **新增** 纯函数 buildRoomName |
| `src/room-provisioner.ts` | **新增** provisionTaskRoom 编排 |
| `src/index.ts` | export 两个模块 |
| `tests/room-name.test.mjs` | 7 测试 |
| `tests/room-provisioner.test.mjs` | 3 测试 |

## 交付形态

```ts
import { buildRoomName, provisionTaskRoom } from 'dsh-matrix-connector';

buildRoomName('修复登录 bug', 'T-42');
// → '[T-42] 修复登录 bug'

const { roomId, roomName } = await provisionTaskRoom({ client, agora, taskId: 'T-42' });
// agora.getTask → buildRoomName → client.createRoom({ name })
```

## R-C 全链路状态

- ✅ R-C-1 (dsh-agora PR#12): threadTaskBindingService — Core 持有 opaque threadKey↔taskId
- ✅ **R-C-2 (本 PR)**: adapter 创建 room 时投影 Task title → room name

## 下一步 (tier1 收尾)

- R-D matrix side: reply-to event listener → recordInboundReply (复用 agora-rest.getTask + thread-registry)
- R-E: Space 嵌套 (跨仓, 延后)
- R-F: thread web 详情面板 (前端, 延后)