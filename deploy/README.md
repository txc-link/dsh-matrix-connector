# 多机多 DSH × Matrix 部署手册

把 `agora-ts`（任务编排核心）+ `Synapse`（Matrix 服务端）+ `dsh-matrix-connector`
（每个 DSH 节点一个）部署到 N 台机器。

## 1. 架构总览

```
┌────────────────────── 核心服务器 CORE (1 台) ──────────────────────┐
│                                                                   │
│  ① Synapse + Postgres (docker compose)                            │
│     homeserver  → http://<CORE_IP>:8008                            │
│     server_name → agent-hub.local (内部名, 联邦关闭, 无需 DNS)      │
│                                                                   │
│  ② agora-ts server (Node)                                         │
│     REST → http://<CORE_IP>:18008  (Bearer token 鉴权)             │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
        ▲ homeserver :8008              ▲ agora REST :18008
        │                               │
┌───────┴──────────┐      ┌────────────┴──────────┐
│ DSH 节点 A       │      │ DSH 节点 B             │
│ dsh-matrix-conn  │      │ dsh-matrix-conn       │
│ plugin           │      │ plugin                │
│ bot: dsh-bridge- │      │ bot: dsh-bridge-      │
│      node-a      │      │      node-b           │
└──────────────────┘      └───────────────────────┘
```

- **CORE 一台**：Synapse + agora-ts（+ 可选 agora dashboard）
- **DSH 每台一个**：装 plugin，各配一个独立 bot 账号
- 所有 DSH 连**同一个** homeserver + **同一个** agora server

## 2. URL 规划表

| 角色 | URL | 说明 |
|---|---|---|
| Synapse homeserver | `http://<CORE_IP>:8008` | Element / plugin 连这个 |
| agora-ts REST | `http://<CORE_IP>:18008` | plugin 连这个 |
| agora API token | 部署时随机生成 | 写进 `agora-config.json` + 每个节点 patch |
| bot mxid | `@dsh-bridge-node-<n>:agent-hub.local` | 每个 DSH 节点一个 |
| server_name | `agent-hub.local` | Synapse 内部域名；**不用 DNS**，客户端走 IP |

## 3. 执行顺序（3 步）

```bash
# ── 第 1 步：核心服务器（跑一次）──────────────────────────
# 1a. 准备 Synapse（已有 matrix-hub 可跳过）
#     参考 https://github.com/matrix-org/synapse 的 docker compose，
#     或复用本机 /home/ailink/matrix-hub 的 deploy/docker-compose.yaml
# 1b. 部署 agora-ts + 生成 token + 起服务
./01-deploy-core.sh --core-ip 8.136.15.147 --port 18008
#     → 生成 agora-config.json（含随机 api token）、nohup 起 server、PID 文件
#     → 验证: curl http://<CORE_IP>:18008/api/health

# ── 第 2 步：创建 N 个 bot 账号（跑一次，在能访问 Synapse 的机器上）──
./02-provision-bots.sh --homeserver http://8.136.15.147:8008 \
    --admin-token '<root_admin_token>' --nodes 3 --server-name agent-hub.local
#     → 生成 node-a.env / node-b.env / node-c.env（各含 token，0600 权限）

# ── 第 3 步：每台 DSH 节点执行（N 次，每台一次）────────────
./03-install-dsh-plugin.sh --profile web \
    --homeserver http://8.136.15.147:8008 \
    --agora-url http://8.136.15.147:18008 --agora-token '<api_token>' \
    --node-id node-a --env-file ./node-a.env \
    --connector-src /path/to/dsh-matrix-connector   # 或 git url
#     → dsh plugin add + 写 ~/.dsh/profiles/web/cordis.patch.yml + 重启提示

# ── 验证（任一台 DSH 或核心机）──────────────────────────
./04-verify.sh --homeserver http://8.136.15.147:8008 \
    --agora http://8.136.15.147:18008 --admin-token '<root_admin_token>'
```

## 4. 常见问题

- **admin token 哪来**：本机用 `matrix-hub/scripts/bootstrap.sh admin` 生成；
  其他 Synapse 用 `register_new_matrix_user -c homeserver.yaml admin admin` 或
  admin API 登录。
- **改 agora api token**：重跑 `01-deploy-core.sh` 会重新生成并提示你同步
  各节点 patch。
- **DSH 重启**：改完 patch 后重启 `dsh web`（`dsh --profile web`）生效。
- **ERP 变量（AGORA_HOME_DIR 等）**：默认不设（用 `~/.agora`）。仅在 `/root`
  只读等受限环境才需要设，见 `01-deploy-core.sh` 注释。

## 5. Win / Mac 手动装机附录（node-b / node-c）

CORE 侧无法代装的机器，手动执行以下三步（Linux 03 脚本的等价翻译）。凭据值在 CORE 的 `deploy/node-b.env`（Win）/ `node-c.env`（Mac），agora api token 在 CORE `/root/.agora/api-token`。

### ① 安装插件

```bash
# Windows PowerShell / macOS 相同
dsh plugin --profile web add <connector 源码路径>
```

### ② 追加 profile patch（`~/.dsh/profiles/web/cordis.patch.yml` 末尾）

```yaml
# ── dsh-matrix-connector (node: node-b) ─────────────────────────────
# Mac 换 node-c: userId/deviceId/nodeId 换成 node-c.env 对应值
- insert:
    - id: matrix-connector
      name: 'dsh-matrix-connector'
      config:
        homeserverUrl: 'http://8.136.15.147:8008'
        userId: '@dsh-bridge-node-b:agent-hub.local'
        accessToken: '<node-b.env 的 MATRIX_ACCESS_TOKEN>'
        deviceId: '<node-b.env 的 MATRIX_DEVICE_ID>'
        agoraServerUrl: 'http://8.136.15.147:18008'
        agoraApiToken: '<CORE /root/.agora/api-token 同值>'
        nodeId: 'node-b'
        commandName: 'agora'
        nodeEnabled: true
        shareSessionInChannel: false
        allowFrom: '*'
        autoJoin: true
        eventPollIntervalMs: 5000
        requestTimeoutMs: 10000
```

### ③ 校验 + 重启 + 回报

```bash
dsh --profile web --dump-config | grep matrix-connector   # 有输出 = 配置进入
dsh --profile web                                          # 重启生效
```

两台都装完后告诉 CORE 侧 agent「Win/Mac 已装」，agent 会跑三机 `04-verify.sh` 回归并 goal 收官。

常见问题：
- `dump` 未见 matrix-connector → patch YAML 缩进（`- insert:` 下两级）或引号
- bot 登录失败 → token 整串复制（`syt_` 开头）、homeserver 是 `http://`（CORE 未开 TLS）
- 房间没反应 → CORE 侧 agent 可代拉房间邀请（node-b/c 已预先被邀请进组织房间, autoJoin 自动入房）
