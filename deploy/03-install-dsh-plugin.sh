#!/usr/bin/env bash
# 03-install-dsh-plugin.sh — 在【一台 DSH 节点】上安装并配置 dsh-matrix-connector。
#
# 用法（每台 DSH 执行一次, 参数不同）:
#   ./03-install-dsh-plugin.sh \
#       --profile web \
#       --homeserver http://<CORE_IP>:8008 \
#       --agora-url http://<CORE_IP>:18008 \
#       --agora-token '<api_token>' \
#       --node-id node-a \
#       --env-file node-a.env \
#       --connector-src /path/to/dsh-matrix-connector   # 或 git@github.com:...git
#
# 效果:
#   1) dsh plugin --profile <p> add <connector>  (pnpm add 到 profile)
#   2) 在 ~/.dsh/profiles/<p>/cordis.patch.yml 追加 matrix-connector row
#      (从 node-*.env 读 bot 凭据; agora token 从命令行)
#   3) 提示重启 dsh

set -euo pipefail

PROFILE="web"
HOMESERVER=""
AGORA_URL=""
AGORA_TOKEN=""
NODE_ID=""
ENV_FILE=""
CONNECTOR_SRC=""
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

usage() { sed -n '2,24p' "$0"; exit 1; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2;;
    --homeserver) HOMESERVER="$2"; shift 2;;
    --agora-url) AGORA_URL="$2"; shift 2;;
    --agora-token) AGORA_TOKEN="$2"; shift 2;;
    --node-id) NODE_ID="$2"; shift 2;;
    --env-file) ENV_FILE="$2"; shift 2;;
    --connector-src) CONNECTOR_SRC="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; usage;;
  esac
done
[[ -z "$HOMESERVER" || -z "$AGORA_URL" || -z "$AGORA_TOKEN" || -z "$NODE_ID" || -z "$ENV_FILE" || -z "$CONNECTOR_SRC" ]] && {
  echo "error: --homeserver --agora-url --agora-token --node-id --env-file --connector-src required" >&2; usage;
}
[[ -f "$ENV_FILE" ]] || { echo "error: env file not found: $ENV_FILE" >&2; exit 1; }

PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
[[ -d "$PROFILE_DIR" ]] || { echo "error: profile dir not found: $PROFILE_DIR" >&2; exit 1; }

# ── 1. 安装插件包 ────────────────────────────────────────────────────
echo "[1] installing dsh-matrix-connector into profile '$PROFILE'"
dsh plugin --profile "$PROFILE" add "$CONNECTOR_SRC"

# ── 2. 读 bot 凭据 ───────────────────────────────────────────────────
set -a; source "$ENV_FILE"; set +a
: "${MATRIX_HOMESERVER_URL:?env missing}"
: "${MATRIX_USER_ID:?env missing}"
: "${MATRIX_ACCESS_TOKEN:?env missing}"
: "${MATRIX_DEVICE_ID:?env missing}"

# ── 3. 追加 patch row (幂等: 已存在则跳过) ───────────────────────────
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
echo "[4] verifying: dsh --profile $PROFILE --dump-config | grep matrix-connector"
if dsh --profile "$PROFILE" --dump-config 2>/dev/null | grep -q "matrix-connector"; then
  echo "✅ matrix-connector 已进入 profile 配置"
else
  echo "⚠️  dump 未见 matrix-connector, 请检查 $PATCH_FILE (YAML 缩进/引号)" >&2
fi

echo
echo "✅ 完成。重启 DSH 生效:"
echo "    dsh --profile $PROFILE   (或重启现有 dsh web 服务)"
echo "    验证: 在 Matrix 房间给 $MATRIX_USER_ID 发消息 /agora im health"
