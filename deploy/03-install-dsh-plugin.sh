#!/usr/bin/env bash
# 03-install-dsh-plugin.sh — 在【一台 DSH 节点】上安装并配置两个插件:
#   ① dsh-agora-plugin   (npm) — 治理接入: 任务派发/心跳/交付 (连接 agora-ts)
#   ② dsh-matrix-connector (npm 0.1.7) — IM 对话 bot (连接 Matrix homeserver + agora-ts)
#
# 用法（每台 DSH 执行一次, 参数不同）:
#   ./03-install-dsh-plugin.sh \
#       --profile web \
#       --homeserver http://<CORE_IP>:8008 \
#       --agora-url http://<CORE_IP>:18008 \
#       --agora-token '<server api_token>' \
#       --node-token '<agora_node_xxx worker token>' \
#       --node-id node-b \
#       --env-file node-b.env \
#       --agent-workspace '/home/me/workspace' \
#       [--display-name 'Node B Agent'] [--max-concurrent 2] \
#       [--skip-governance]            # 只装 connector, 跳过 dsh-agora-plugin
#       [--connector-src /path|git]    # 备选: 源码安装 connector (默认 npm 包)
#
# 效果:
#   1) dsh plugin --profile <p> add dsh-agora-plugin (npm) [+ connector]
#   2) 在 ~/.dsh/profiles/<p>/cordis.patch.yml 追加 agora row + matrix-connector row
#      (bot 凭据从 node-*.env 读; server/worker token 从命令行)
#   3) dump-config 校验 + 提示重启
#
# 凭据来源 (CORE 侧):
#   server api_token → /root/.agora/api-token
#   worker token     → agora node-credentials issue <node-id> --scope heartbeat
#                      --scope dispatch --scope delivery (明文仅签发一次)

set -euo pipefail

PROFILE="web"
HOMESERVER=""
AGORA_URL=""
AGORA_TOKEN=""
NODE_TOKEN=""
NODE_ID=""
ENV_FILE=""
CONNECTOR_SRC=""
AGENT_WORKSPACE="${HOME}"
DISPLAY_NAME=""
MAX_CONCURRENT="2"
SKIP_GOVERNANCE="0"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

usage() { sed -n '2,36p' "$0"; exit 1; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2;;
    --homeserver) HOMESERVER="$2"; shift 2;;
    --agora-url) AGORA_URL="$2"; shift 2;;
    --agora-token) AGORA_TOKEN="$2"; shift 2;;
    --node-token) NODE_TOKEN="$2"; shift 2;;
    --node-id) NODE_ID="$2"; shift 2;;
    --env-file) ENV_FILE="$2"; shift 2;;
    --connector-src) CONNECTOR_SRC="$2"; shift 2;;
    --agent-workspace) AGENT_WORKSPACE="$2"; shift 2;;
    --display-name) DISPLAY_NAME="$2"; shift 2;;
    --max-concurrent) MAX_CONCURRENT="$2"; shift 2;;
    --skip-governance) SKIP_GOVERNANCE="1"; shift;;
    *) echo "unknown arg: $1" >&2; usage;;
  esac
done
[[ -z "$HOMESERVER" || -z "$AGORA_URL" || -z "$AGORA_TOKEN" || -z "$NODE_ID" || -z "$ENV_FILE" ]] && {
  echo "error: --homeserver --agora-url --agora-token --node-id --env-file required" >&2; usage;
}
[[ -f "$ENV_FILE" ]] || { echo "error: env file not found: $ENV_FILE" >&2; exit 1; }
[[ "$SKIP_GOVERNANCE" == "1" || -n "$NODE_TOKEN" ]] || {
  echo "error: --node-token required (worker token; CORE: agora node-credentials issue $NODE_ID --scope heartbeat --scope dispatch --scope delivery)" >&2; usage;
}
[[ -z "$DISPLAY_NAME" ]] && DISPLAY_NAME="Node ${NODE_ID} Agent"

PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
[[ -d "$PROFILE_DIR" ]] || { echo "error: profile dir not found: $PROFILE_DIR" >&2; exit 1; }

# ── 1. 安装插件包 ────────────────────────────────────────────────────
if [[ "$SKIP_GOVERNANCE" == "1" ]]; then
  echo "[1] skip dsh-agora-plugin (--skip-governance)"
else
  if grep -q "^- id: agora$" "$PATCH_FILE" 2>/dev/null; then
    echo "[1] agora row already present — skip dsh-agora-plugin install"
  else
    echo "[1] installing dsh-agora-plugin (npm) into profile '$PROFILE'"
    dsh plugin --profile "$PROFILE" add dsh-agora-plugin
  fi
fi
if [[ -n "$CONNECTOR_SRC" ]]; then
  echo "[1] installing dsh-matrix-connector from source: $CONNECTOR_SRC"
  dsh plugin --profile "$PROFILE" add "$CONNECTOR_SRC"
else
  echo "[1] installing dsh-matrix-connector (npm) into profile '$PROFILE'"
  dsh plugin --profile "$PROFILE" add dsh-matrix-connector
fi

# ── 2. 读 bot 凭据 ───────────────────────────────────────────────────
set -a; source "$ENV_FILE"; set +a
: "${MATRIX_HOMESERVER_URL:?env missing}"
: "${MATRIX_USER_ID:?env missing}"
: "${MATRIX_ACCESS_TOKEN:?env missing}"
: "${MATRIX_DEVICE_ID:?env missing}"

# ── 3. 追加 patch row (幂等: 已存在则跳过) ───────────────────────────
if [[ "$SKIP_GOVERNANCE" != "1" ]] && ! grep -q "^- id: agora$" "$PATCH_FILE" 2>/dev/null; then
  echo "[3] appending agora row (dsh-agora-plugin) to $PATCH_FILE"
  cat >> "$PATCH_FILE" <<EOF

# ── dsh-agora-plugin (node: $NODE_ID) ─────────────────────────────────
# 由 deploy/03-install-dsh-plugin.sh 自动生成; 改配置后重启 dsh 生效。
- id: agora
  name: 'dsh-agora-plugin'
  config:
    serverUrl: '$AGORA_URL'
    apiToken: '$AGORA_TOKEN'
    nodeApiToken: '$NODE_TOKEN'
    requestTimeoutMs: 10000
    defaultCreator: 'dsh'
    commandName: 'agora'
    nodeEnabled: true
    nodeId: '$NODE_ID'
    maxConcurrent: $MAX_CONCURRENT
    runtimeAgents:
      - id: 'default'
        displayName: '$DISPLAY_NAME'
        workspace: '$AGENT_WORKSPACE'
        roles: ['general']
        capabilities: ['research', 'coding']
EOF
else
  echo "[3] agora row present or skipped — skip"
fi

if grep -q "matrix-connector" "$PATCH_FILE" 2>/dev/null; then
  echo "[3] matrix-connector row already present in $PATCH_FILE — skip"
else
  echo "[3] appending matrix-connector row to $PATCH_FILE"
  cat >> "$PATCH_FILE" <<EOF

# ── dsh-matrix-connector (node: $NODE_ID) ─────────────────────────────
# 由 deploy/03-install-dsh-plugin.sh 自动生成; 改配置后重启 dsh 生效。
- insert:
    - id: matrix-connector
      name: 'dsh-matrix-connector'
      config:
        homeserverUrl: '$HOMESERVER'
        userId: '$MATRIX_USER_ID'
        accessToken: '$MATRIX_ACCESS_TOKEN'
        deviceId: '$MATRIX_DEVICE_ID'
        agoraServerUrl: '$AGORA_URL'
        agoraApiToken: '$AGORA_TOKEN'
        nodeId: '$NODE_ID'
        commandName: 'agora'
        nodeEnabled: true
        shareSessionInChannel: false
        allowFrom: '*'
        autoJoin: true
        eventPollIntervalMs: 5000
        requestTimeoutMs: 10000
EOF
fi

# ── 4. 验证 patch 语法 (dump) ────────────────────────────────────────
DUMP="$(dsh --profile "$PROFILE" --dump-config 2>/dev/null || true)"
OK=1
if [[ "$SKIP_GOVERNANCE" != "1" ]]; then
  if echo "$DUMP" | grep -q "^- id: agora$\|agora"; then
    echo "✅ dsh-agora-plugin 已进入 profile 配置"
  else
    echo "⚠️  dump 未见 agora row, 请检查 $PATCH_FILE (YAML 缩进/引号)" >&2; OK=0
  fi
fi
if echo "$DUMP" | grep -q "matrix-connector"; then
  echo "✅ matrix-connector 已进入 profile 配置"
else
  echo "⚠️  dump 未见 matrix-connector, 请检查 $PATCH_FILE (YAML 缩进/引号)" >&2; OK=0
fi

echo
echo "✅ 完成。重启 DSH 生效:"
echo "    dsh --profile $PROFILE   (或重启现有 dsh web 服务)"
echo "验证:"
echo "    Matrix 房间给 $MATRIX_USER_ID 发 /agora im health"
echo "    CORE: agora node list  → $NODE_ID heartbeat 时间为最近"

[[ "$OK" == "1" ]] || exit 2
