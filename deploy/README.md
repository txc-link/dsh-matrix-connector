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
