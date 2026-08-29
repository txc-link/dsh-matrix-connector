#!/usr/bin/env bash
# 02-provision-bots.sh — 在 Synapse 上批量创建 N 个 DSH bot 账号。
#
# 用法:
#   ./02-provision-bots.sh --homeserver http://<CORE_IP>:8008 \
#       --admin-token '<root_admin_token>' --nodes 3 [--server-name agent-hub.local]
#
# 每个账号: dsh-bridge-node-<a|b|c...>, 输出 node-<x>.env (chmod 600)。
# 复用 scripts/provision-bot.sh 的逻辑; 需要 Synapse admin token
# (matrix-hub: ./scripts/bootstrap.sh admin; 其他: register_new_matrix_user 或 admin API)。
#
# 产出: node-a.env / node-b.env / ... 每个含 MATRIX_* + DSH_NODE_ID。

set -euo pipefail

HOMESERVER=""
ADMIN_TOKEN=""
NODES=""
SERVER_NAME="agent-hub.local"
BOT_PASSWORD=""

usage() { sed -n '2,14p' "$0"; exit 1; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --homeserver) HOMESERVER="$2"; shift 2;;
    --admin-token) ADMIN_TOKEN="$2"; shift 2;;
    --nodes) NODES="$2"; shift 2;;
    --server-name) SERVER_NAME="$2"; shift 2;;
    --bot-password) BOT_PASSWORD="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; usage;;
  esac
done
[[ -z "$HOMESERVER" || -z "$ADMIN_TOKEN" || -z "$NODES" ]] && { echo "error: --homeserver --admin-token --nodes required" >&2; usage; }

# 字母序列: node-a node-b ... node-z node-aa ...（a-z 足够时直接映射）
declare -a LETTERS=(a b c d e f g h i j k l m n o p q r s t u v w x y z)
letters() { echo "${LETTERS[$((($1 - 1) % 26))]}"; }

for ((i = 0; i < NODES; i++)); do
  (( i >= 26 )) && { echo "warn: 超过 26 个节点, 名字会复用, 建议拆两次跑" >&2; }
  SUFFIX="$(letters $((i + 1)))"
  NODE_ID="node-${SUFFIX}"
  echo "── [$((i + 1))/$NODES] provisioning $NODE_ID ──"
  bash "$(dirname "$0")/../scripts/provision-bot.sh" \
    --homeserver "$HOMESERVER" \
    --admin-token "$ADMIN_TOKEN" \
    --node-id "$NODE_ID" \
    --server-name "$SERVER_NAME" \
    --display-name "DSH Bridge ($NODE_ID)" \
    --output "${NODE_ID}.env" \
    ${BOT_PASSWORD:+--bot-password "$BOT_PASSWORD"} \
    || { echo "❌ $NODE_ID failed" >&2; exit 1; }
done

echo
echo "✅ 全部 $NODES 个 bot 创建完成:"
ls -la node-*.env
echo
echo "下一步: 每台 DSH 节点执行 03-install-dsh-plugin.sh 时用对应 node-*.env"
