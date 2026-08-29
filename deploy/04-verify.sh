#!/usr/bin/env bash
# 04-verify.sh — 部署后端到端验证（任一能访问 Synapse + agora 的机器）。
#
# 用法:
#   ./04-verify.sh --homeserver http://<CORE_IP>:8008 \
#       --agora http://<CORE_IP>:18008 --admin-token '<root_admin_token>' \
#       [--agora-token '<api_token>']
#
# --agora-token 可省略: 会自动从 ./runtime/agora-config.json 读 (01 脚本的产物)。

set -euo pipefail

HOMESERVER=""
AGORA=""
ADMIN_TOKEN=""
AGORA_TOKEN=""

usage() { sed -n '2,20p' "$0"; exit 1; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --homeserver) HOMESERVER="$2"; shift 2;;
    --agora) AGORA="$2"; shift 2;;
    --admin-token) ADMIN_TOKEN="$2"; shift 2;;
    --agora-token) AGORA_TOKEN="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; usage;;
  esac
done
[[ -z "$HOMESERVER" || -z "$AGORA" || -z "$ADMIN_TOKEN" ]] && { echo "error: all args required" >&2; usage; }

# 未显式传 agora token 时, 尝试从 01 脚本产物读取
if [[ -z "$AGORA_TOKEN" && -f "$(dirname "$0")/runtime/agora-config.json" ]]; then
  AGORA_TOKEN="$(sed -n 's/.*"token" *: *"\([^"]*\)".*/\1/p' "$(dirname "$0")/runtime/agora-config.json" | head -1)"
fi

pass() { echo "  ✅ $*"; }
fail() { echo "  ❌ $*"; return 1; }

echo "── [1/4] Synapse ──"
VERSIONS="$(curl -s -m 5 "$HOMESERVER/_matrix/client/versions")"
echo "$VERSIONS" | grep -q '"v1.11"' && pass "Synapse 可达 ($HOMESERVER)" || fail "Synapse 不可达"

echo "── [2/4] agora-ts health ──"
HEALTH="$(curl -s -m 5 "$AGORA/api/health")"
echo "$HEALTH" | grep -q '"ok"' && pass "agora-ts ok ($AGORA)" || fail "agora-ts: $HEALTH"

echo "── [3/4] agora api token (建任务) ──"
TOKEN_HEADER=""
# api_auth 可能启用或未启用; 两种都试
CREATE_BODY='{"title":"deploy-verify-'$RANDOM'","type":"coding","priority":"normal","creator":"user:deploy","description":"verify","locale":"zh-CN"}'
if TOKEN_RESP="$(curl -s -m 5 -X POST "$AGORA/api/tasks" -H "Content-Type: application/json" -H "Authorization: Bearer $AGORA_TOKEN" -d "$CREATE_BODY")"; then
  echo "$TOKEN_RESP" | grep -q '"id"' && pass "token 有效, 建任务成功" || true
fi
if ! echo "$TOKEN_RESP" | grep -q '"id"'; then
  if UNTOK="$(curl -s -m 5 -X POST "$AGORA/api/tasks" -H "Content-Type: application/json" -d "$CREATE_BODY")"; then
    echo "$UNTOK" | grep -q '"id"' && pass "api_auth 未启用, 无 token 可建" || fail "建任务失败: $UNTOK"
  fi
fi

echo "── [4/4] 真实 homeserver 往返 (建 bot 临时账号) ──"
TMP_USER="verify-$(date +%s)"
MXID="@${TMP_USER}:agent-hub.local"
curl -s -m 10 -X PUT "$HOMESERVER/_synapse/admin/v2/users/$MXID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"password":"verify-2026","admin":false,"deactivated":false}' >/dev/null \
  && pass "临时账号创建 $MXID" || fail "admin API 建号失败 (token 对吗?)"
LOGIN="$(curl -s -m 10 -X POST "$HOMESERVER/_matrix/client/v3/login" -H "Content-Type: application/json" \
  -d '{"type":"m.login.password","user":"'"$TMP_USER"'","password":"verify-2026"}')"
TOK="$(echo "$LOGIN" | sed -n 's/.*"access_token" *: *"\([^"]*\)".*/\1/p')"
if [[ -n "$TOK" ]]; then
  pass "登录成功 (token 长度 ${#TOK})"
  ROOM="$(curl -s -m 10 -X POST "$HOMESERVER/_matrix/client/v3/createRoom" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d '{"name":"verify"}')"
  echo "$ROOM" | grep -q '"room_id"' && pass "建房成功: $(echo "$ROOM" | sed -n 's/.*"room_id" *: *"\([^"]*\)".*/\1/p')" || fail "建房失败"
else
  fail "登录失败: $LOGIN"
fi

echo
echo "── 汇总 ──"
echo "如果上面有 ❌, 按 README.md 排查; 全部 ✅ 则部署完成。"
echo "最后一步: 在 Element 里邀请各 DSH bot 进房间, 发 /agora im health 验证插件。"
