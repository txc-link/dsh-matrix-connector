# Task: T-1 matrix real MatrixTransport (2026-08-30)

## 1. 目标

把 dsh-matrix-connector 仓的 stub MatrixTransport 换成真实 matrix-js-sdk 实现, 接服务器已有 homeserver (`agent-hub.local`, synapse 1.155.0, postgres 16). R4 Room auto-create 真正能 create room, 不只是 audit 落盘.

## 2. 范围

### 必须 (本 PR)
1. `src/transport/matrix-js-sdk.ts` — `MatrixJsSdkTransport implements MatrixTransport` (基于 sdk@34.13.0 的 createClient + startClient + sendEvent + createRoom)
2. `src/transport/connection.ts` — loginWithAccessToken (access_token 而非 password flow)
3. `MatrixClient.createRoom(name, opts)` — 扩展现有 wrapper 暴露 createRoom (R4 真正能用)
4. `src/transport/index.ts` — factory: bot mode (默认), app-service mode 占位 (留 seam)
5. `tests/matrix-transport.test.mjs` — unit test 用 stub homeserver mock (matrix-js-sdk 不易 mock, 用 fetch-level mock)
6. `tests/smoke-real-homeserver.mjs` — 真实 E2E smoke (localhost:8008 / dsh-bridge-node-a / create room + send + assert)
7. `Doc/09-PLANNING/TASKS/2026-08-30-matrix-t1-real-transport/{task_plan,findings,progress}.md`

### 不做 (后续段)
- ❌ E2EE crypto (T-7, 留 seam 不实现)
- ❌ app-service 真实注册 (T-10)
- ❌ thread → agora Task 双向 (T-1.5 / R-C)
- ❌ S3 attachments (T-9 / R-I)

## 3. 设计

```ts
// src/transport/matrix-js-sdk.ts
import { createClient, type MatrixClient as SdkMatrixClient } from 'matrix-js-sdk';

export interface MatrixJsSdkTransportOptions {
  homeserverUrl: string;
  accessToken: string;
  userId: string;
  deviceId?: string;
}

export class MatrixJsSdkTransport implements MatrixTransport {
  private sdk: SdkMatrixClient | null = null;
  constructor(opts: MatrixJsSdkTransportOptions) { /* deferred login */ }

  async connect(): Promise<void> {
    this.sdk = createClient({
      baseUrl: this.opts.homeserverUrl,
      accessToken: this.opts.accessToken,
      userId: this.opts.userId,
      deviceId: this.opts.deviceId,
    });
    await this.sdk.startClient({ initialSyncLimit: 0 });
    await this.sdk.initRustCrypto(); // T-7 后续, 暂失败 swallow
  }

  async createRoom(opts: { name?: string; topic?: string; visibility?: 'public'|'private'; preset?: string }) {
    if (!this.sdk) throw new Error('not connected');
    const resp = await this.sdk.createRoom({ name: opts.name, topic: opts.topic, visibility: opts.visibility as any, preset: opts.preset as any });
    return { roomId: resp.room_id };
  }

  async sendRoomMessage(msg: MatrixRoomMessage): Promise<MatrixSendReceipt> {
    if (!this.sdk) throw new Error('not connected');
    const content = {
      msgtype: msg.msgType ?? 'm.text',
      body: msg.body,
      ...(msg.formattedBody ? { formatted_body: msg.formattedBody, format: msg.format ?? 'org.matrix.custom.html' } : {}),
    };
    const resp = await this.sdk.sendEvent(msg.roomId, 'm.room.message' as any, content);
    return { eventId: resp.event_id, roomId: msg.roomId };
  }

  // editRoomMessage / uploadBytes / startSync / stopSync 略
}
```

```ts
// MatrixClient 扩展
class MatrixClient {
  async createRoom(name: string, opts: { topic?: string } = {}): Promise<{ roomId: string }> {
    // delegates to transport.createRoom
  }
}
```

## 4. homeserver 配置 (turn 120 发现)

- server_name: `agent-hub.local`
- URL (本地): `http://localhost:8008` (HTTP) + `https://localhost:8448` (HTTPS)
- well-known: `https://agent-hub.local:18443/`
- 已存在 bridge user: `@dsh-bridge-node-a:agent-hub.local` (device MZRCFMCQKU) + `@dsh-bridge-node-c:agent-hub.local`
- 验证: createRoom 真实返回 `room_id`
- access_token 走 env var (不入仓)

## 5. worktree

- path: `/home/ailink/dsh-agora/.repos/dsh-matrix-connector/.worktrees/feat-matrix-t1-real-transport`
- branch: `feat/matrix-t1-real-transport` (base main `71c01f6`)

## 6. 验证

- `npm run build` 0
- `npm run typecheck` 0
- `node --test tests/*.test.mjs` 全绿 (含新增 matrix-transport.test.mjs)
- `tests/smoke-real-homeserver.mjs` (受 env 控制, 真实 homeserver 跑过)
- `tests/matrix-client.test.mjs` 不破坏