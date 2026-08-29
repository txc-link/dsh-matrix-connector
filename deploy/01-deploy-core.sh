#!/usr/bin/env bash
# 01-deploy-core.sh — 在核心服务器部署 agora-ts server（+ 生成 api token）。
#
# 用法:
#   ./01-deploy-core.sh --core-ip <IP> [--port 18008] [--agora-src <path|git-url>]
#
# 前提:
#   - 核心机可访问（本脚本在核心机上执行，或目标机可 SSH）
#   - Node.js >= 20, npm 可用
#   - Synapse 已部署（另见 matrix-hub / Synapse docker compose）
#
# 产出:
#   - $DEPLOY_DIR/agora-config.json      agora 配置（含随机 api token, chmod 600）
#   - $DEPLOY_DIR/agora-server.pid       服务 PID
#   - $DEPLOY_DIR/agora.log              nohup 日志
#   - 验证: curl http://<core-ip>:<port>/api/health

set -euo pipefail

CORE_IP=""
PORT="18008"
AGORA_SRC=""
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)/runtime"
WORK_DIR=""

usage() { sed -n '2,16p' "$0"; exit 1; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --core-ip) CORE_IP="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --agora-src) AGORA_SRC="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; usage;;
  esac
done
[[ -z "$CORE_IP" ]] && { echo "error: --core-ip required" >&2; usage; }

# ── 1. 准备 agora-ts 源码 ───────────────────────────────────────────
if [[ -z "$AGORA_SRC" ]]; then
  # 自动探测: 脚本在 dsh-agora/.repos/dsh-matrix-connector/deploy/ 内嵌场景
  for cand in "$(cd "$(dirname "$0")/../../.." && pwd)" "$HOME/dsh-agora" "$HOME/Agora"; do
    if [[ -d "$cand/agora-ts" ]]; then AGORA_SRC="$cand"; break; fi
  done
fi
if [[ -z "$AGORA_SRC" ]]; then
  echo "error: 未找到 agora-ts 源码, 请用 --agora-src 指定 dsh-agora 路径或 git url" >&2
  usage
fi
if [[ "$AGORA_SRC" == git@* || "$AGORA_SRC" == https://* ]]; then
  WORK_DIR="$DEPLOY_DIR/agora-ts"
  echo "[1] cloning $AGORA_SRC → $WORK_DIR"
  git clone --depth 1 "$AGORA_SRC" "$WORK_DIR"
else
  WORK_DIR="$AGORA_SRC"
  echo "[1] using local agora-ts at $WORK_DIR"
fi
AGORA_TS_DIR="$WORK_DIR/agora-ts"
[[ -d "$AGORA_TS_DIR" ]] || { echo "error: no agora-ts/ under $WORK_DIR" >&2; exit 1; }

# ── 2. build ─────────────────────────────────────────────────────────
echo "[2] npm ci + build (agora-ts)"
( cd "$AGORA_TS_DIR" && npm ci --include=dev && npm run build )

# ── 3. 生成配置（随机 api token）──────────────────────────────────────
mkdir -p "$DEPLOY_DIR"
API_TOKEN="$(head -c 24 /dev/urandom | base64 | tr -d '=/+' | head -c 32)"
cat > "$DEPLOY_DIR/agora-config.json" <<EOF
{
  "db_path": "$DEPLOY_DIR/agora.db",
  "api_auth": { "enabled": true, "token": "$API_TOKEN" },
  "scheduler": { "enabled": true }
}
EOF
chmod 600 "$DEPLOY_DIR/agora-config.json"
echo "[3] api token (记下来, 各 DSH 节点要用):"
echo "    $API_TOKEN"

# ── 4. 起服务 (nohup) ────────────────────────────────────────────────
echo "[4] starting agora-ts on http://$CORE_IP:$PORT"
( cd "$AGORA_TS_DIR/apps/server" && \
  nohup node dist/index.js \
    > "$DEPLOY_DIR/agora.log" 2>&1 &
  echo $! > "$DEPLOY_DIR/agora-server.pid" )
sleep 6

# ── 5. 验证 ──────────────────────────────────────────────────────────
HEALTH="$(curl -s -m 5 "http://127.0.0.1:$PORT/api/health" || true)"
echo "[5] health: $HEALTH"
if echo "$HEALTH" | grep -q '"ok"'; then
  echo "✅ agora-ts 部署成功: http://$CORE_IP:$PORT"
  echo "   API token 已写入 $DEPLOY_DIR/agora-config.json (chmod 600)"
  echo "   停止: kill \$(cat $DEPLOY_DIR/agora-server.pid)"
else
  echo "❌ agora-ts 未起来, 看日志: tail -50 $DEPLOY_DIR/agora.log" >&2
  exit 1
fi

# 可选: 受限环境 (如 /root 只读) 需加 AGORA_HOME_DIR / AGORA_SKILL_TARGET_DIRS /
# AGORA_BRAIN_PACK_ROOT 重定向, 见 docs 或 smoke 记录。
