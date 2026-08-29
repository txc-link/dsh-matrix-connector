# Agora 生态部署地图 — 两个仓库 × 两个插件的关系

- 日期: 2026-08-30 | 权威版本: dsh-agora 主仓 `Doc/10-WALKTHROUGH/2026-08-30-agora-ecosystem-deployment-map.md`（本文为其同步副本）
- 适用: 多机部署方案 C（CORE 1 台 + DSH 节点 N 台）

## 1. 两个仓库是什么

| 仓库 | 定位 | 关键内容 |
|---|---|---|
| **dsh-agora**（`github.com/txc-link/dsh-agora`） | **Agora 平台主仓** | ① `agora-ts/`：CORE 服务端 + CLI + 全部核心包（server/REST :18008）② `dashboard/`：人类控制台 ③ `extensions/dsh-agora/`：**dsh-agora-plugin 插件源码**（npm 包名 `dsh-agora-plugin`）④ SSoT 文档 |
| **dsh-matrix-connector**（`github.com/txc-link/dsh-matrix-connector`） | **Matrix 房间 bot 仓** | `src/`：connector 插件源码（房间消息 ↔ DSH 会话、/agora slash 解析、REST bridge）② `deploy/`：CORE/节点部署脚本 + README 手册 |

一句话：**主仓管"组织 OS 大脑"（CORE + 治理接入插件），connector 仓管"IM 耳朵嘴巴"（房间 bot 插件）。**

## 2. 两个插件是什么、为什么都要装

| | **dsh-agora-plugin**（npm `dsh-agora-plugin@0.6.1`） | **dsh-matrix-connector**（npm `dsh-matrix-connector@0.1.3`；源码仓 GitHub develop） |
|---|---|---|
| 职责 | 节点**治理接入**：把 DSH 会话注册为 Agora runtime agent，接收任务派发（dispatch）、心跳/续租/进度/交付（delivery） | 节点**IM 对话**：bot 身份在 Matrix 房间收发消息，`/agora` slash 命令经 agora REST 转发，task 推送落房间 |
| 连接对象 | agora server REST（:18008） | Synapse homeserver（:8008）+ agora REST（:18008） |
| 凭据 | `apiToken`（管理查询, 用 server 全局 token）+ `nodeApiToken`（worker 专用 scoped token, CORE `agora node-credentials issue` 签发） | bot 的 `accessToken`（Synapse provisioning 生成）+ `agoraApiToken`（server 全局 token） |
| 缺它 | agent 收不到任何任务派发（组织 OS 断链） | 收不到推送、群里无法和 agent 对话 |
| config row | `agora`（patch 中 id: agora） | `matrix-connector` |

两者独立工作、互不依赖：agent 接任务走 dsh-agora-plugin（REST 心跳领取），人类对话走 connector（Matrix 轮询）。**完整节点 = 两个都装。**

## 3. 拓扑与数据流

```
                 CORE（1 台 Linux）
   ┌────────────────────────────────────────────┐
   │ agora-ts server :18008 ← 组织 OS 大脑       │
   │ Synapse :8008 ← Matrix 服务端               │
   │ mem0 :8888 ← 共享记忆   dashboard ← 人类控制台│
   └───────────────┬───────────────┬────────────┘
        REST :18008│               │:8008
   ┌───────────────┴───────────────┴────────────┐
   │            DSH 节点 × N（每台相同装法）        │
   │  DSH 本体                                   │
   │  ├─ dsh-agora-plugin    → 任务派发/回报      │
   │  └─ dsh-matrix-connector→ 房间 bot 对话      │
   └────────────────────────────────────────────┘
```

典型闭环：人类在 Element 发 `/agora 建任务 …` → connector 解析 → agora REST → CORE 建任务并派发 → 节点 dsh-agora-plugin worker 领取 → DSH 会话执行 → 回报 → server 推送进度/task_created → connector 发回房间。**CORE 侧 task_created 推送不依赖任何插件**（server 端 Matrix adapter 直接发）。

## 4. 节点安装速览（详细步骤见 connector 仓 `deploy/README.md` 第 5 节）

**自动化（推荐）**：在节点上跑 connector 仓 `deploy/03-install-dsh-plugin.sh`（装两插件 + 写 agora row + connector row + dump 校验一步到位）。手动路径：

```bash
# ① 治理接入插件（npm）
dsh plugin --profile web add dsh-agora-plugin

# ② IM 对话插件（npm, 首选）
dsh plugin --profile web add dsh-matrix-connector

# 备选（要改源码时）: git clone + 本地路径安装
```

两段 config（agora row + matrix-connector row）都追加到 `~/.dsh/profiles/web/cordis.patch.yml` → `dsh --profile web --dump-config | grep -E "agora|matrix-connector"` 双确认 → 重启 DSH。

凭据来源（CORE 侧）：
- server 管理凭据: `/root/.agora/api-token`
- 节点 worker 凭据: CORE `agora node-credentials issue <node-id> --scope heartbeat --scope dispatch --scope delivery`（明文仅签发一次；node-b/c 已预签发存 `.secrets/win-mac-onboarding.env`）
- bot 凭据: `dsh-matrix-connector/deploy/node-*.env`（node-b=Win, node-c=Mac, 房间邀请已预发）

## 5. 版本口径（2026-08-30）

- `dsh-agora-plugin@0.6.1`（npm）= 主仓 `extensions/dsh-agora` 最新代码（0.6.1: 修复示例 patch row name 旧名 bug）
- connector: npm `dsh-matrix-connector@0.1.3`（2026-08-30 与仓库最新代码比对零差异）+ GitHub `develop`（装机文档）
- node-a（CORE 本机）用 `link:` 本地开发版 dsh-agora，代码与 npm 0.6.1 零差异；生产节点统一用 npm 包
