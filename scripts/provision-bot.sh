#!/usr/bin/env bash
# provision-bot.sh — register a new Matrix bot user for dsh-matrix-connector.
#
# v0.1 mandatory step before installing a new DSH node.
#
# Implementation note: Synapse v1.155 `_synapse/admin/v1/register` requires
# `registration_shared_secret` to be enabled. We avoid that constraint by
# using `_synapse/admin/v2/users/{mxid}` (PUT) which is admin-token-only,
# then log in via /_matrix/client/v3/login to obtain the bot access_token.
#
# Usage:
#   ./provision-bot.sh \
#     --homeserver http://8.136.15.147:8008 \
#     --admin-token <root_admin_token> \
#     --node-id node-a \
#     --display-name "DSH Bridge (Node A)" \
#     --bot-password 'whatever' \
#     --server-name agent-hub.local \
#     --output /root/.dsh/profiles/web/matrix-connector.env
#
# Failure modes (exit codes):
#   1 — admin token rejected or missing / login failed
#   2 — username conflict (node_id already taken)
#   3 — homeserver unreachable
#   4 — admin register API not available on this Synapse version
#   5 — usage error

set -euo pipefail

HOMESERVER=""
ADMIN_TOKEN=""
NODE_ID=""
DISPLAY_NAME=""
OUTPUT=""
SERVER_NAME="agent-hub.local"
BOT_PASSWORD=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --homeserver) HOMESERVER="$2"; shift 2;;
    --admin-token) ADMIN_TOKEN="$2"; shift 2;;
    --node-id) NODE_ID="$2"; shift 2;;
    --display-name) DISPLAY_NAME="$2"; shift 2;;
    --output) OUTPUT="$2"; shift 2;;
    --server-name) SERVER_NAME="$2"; shift 2;;
    --bot-password) BOT_PASSWORD="$2"; shift 2;;
    -h|--help)
      sed -n '2,22p' "$0"; exit 0;;
    *)
      echo "usage error: unknown arg '$1'" >&2; exit 5;;
  esac
done

[[ -z "$HOMESERVER" ]] && { echo "usage error: --homeserver required" >&2; exit 5; }
[[ -z "$ADMIN_TOKEN" ]] && { echo "usage error: --admin-token required" >&2; exit 5; }
[[ -z "$NODE_ID" ]] && { echo "usage error: --node-id required" >&2; exit 5; }
[[ -z "$DISPLAY_NAME" ]] && DISPLAY_NAME="DSH Bridge (${NODE_ID})"
[[ -z "$OUTPUT" ]] && OUTPUT="./matrix-connector.${NODE_ID}.env"
[[ -z "$BOT_PASSWORD" ]] && BOT_PASSWORD="DSH-Bridge-${NODE_ID}-2026"

USERNAME="dsh-bridge-${NODE_ID}"
MXID="@${USERNAME}:${SERVER_NAME}"

echo "homeserver : $HOMESERVER"
echo "server_name: $SERVER_NAME"
echo "node_id    : $NODE_ID"
echo "username   : $USERNAME"
echo "mxid       : $MXID"
echo "display    : $DISPLAY_NAME"
echo "output     : $OUTPUT"

# Probe homeserver reachability
if ! curl --silent --fail --max-time 5 "$HOMESERVER/_matrix/client/versions" >/dev/null; then
  echo "homeserver unreachable: $HOMESERVER" >&2; exit 3;
fi

# Step 1: create user via admin API v2 (PUT) — does NOT require shared secret.
PUT_BODY=$(curl --silent --show-error --max-time 10 \
  -X PUT "$HOMESERVER/_synapse/admin/v2/users/${MXID}" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$BOT_PASSWORD\",\"admin\":false,\"deactivated\":false}" \
  -w "\n__HTTP_STATUS__:%{http_code}" || echo "__HTTP_STATUS__:0")
HTTP_STATUS=$(echo "$PUT_BODY" | grep -oE '__HTTP_STATUS__:[0-9]+' | cut -d: -f2 || echo 0)
JSON=$(echo "$PUT_BODY" | sed 's/__HTTP_STATUS__:.*$//')

case "$HTTP_STATUS" in
  200|201) ;;
  400)
    if echo "$JSON" | grep -qE 'already taken|M_USER_IN_USE'; then
      echo "username conflict: $MXID already exists; pick another --node-id" >&2; exit 2;
    fi
    echo "register failed (400): $JSON" >&2; exit 1;;
  401|403)
    echo "admin token rejected: $JSON" >&2; exit 1;;
  404)
    echo "admin register API not available on this Synapse version" >&2; exit 4;;
  *)
    echo "register failed (status=$HTTP_STATUS): $JSON" >&2; exit 1;;
esac

# Step 2: log in to obtain access_token (PUT does not return one).
LOGIN_BODY=$(curl --silent --show-error --max-time 10 \
  -X POST "$HOMESERVER/_matrix/client/v3/login" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"m.login.password\",\"user\":\"$USERNAME\",\"password\":\"$BOT_PASSWORD\"}" \
  -w "\n__HTTP_STATUS__:%{http_code}")
LOGIN_STATUS=$(echo "$LOGIN_BODY" | grep -oE '__HTTP_STATUS__:[0-9]+' | cut -d: -f2)
LOGIN_JSON=$(echo "$LOGIN_BODY" | sed 's/__HTTP_STATUS__:.*$//')

if [[ "$LOGIN_STATUS" != "200" ]]; then
  echo "login failed (status=$LOGIN_STATUS): $LOGIN_JSON" >&2; exit 1
fi

BOT_USER_ID=$(echo "$LOGIN_JSON" | sed -n 's/.*"user_id" *: *"\([^"]*\)".*/\1/p')
BOT_ACCESS_TOKEN=$(echo "$LOGIN_JSON" | sed -n 's/.*"access_token" *: *"\([^"]*\)".*/\1/p')
DEVICE_ID=$(echo "$LOGIN_JSON" | sed -n 's/.*"device_id" *: *"\([^"]*\)".*/\1/p')

[[ -z "$BOT_USER_ID" || -z "$BOT_ACCESS_TOKEN" || -z "$DEVICE_ID" ]] && {
  echo "login response missing fields: $LOGIN_JSON" >&2; exit 1;
}

# Step 3: set display name
curl --silent --fail --max-time 5 \
  -X PUT "$HOMESERVER/_matrix/client/v3/profile/${BOT_USER_ID}/displayname" \
  -H "Authorization: Bearer $BOT_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"displayname\":\"$DISPLAY_NAME\"}" >/dev/null || true

# Step 4: write the env file (mode 0600 to protect token)
cat > "$OUTPUT" <<EOF
# Auto-generated by provision-bot.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
MATRIX_HOMESERVER_URL=$HOMESERVER
MATRIX_SERVER_NAME=$SERVER_NAME
MATRIX_USER_ID=$BOT_USER_ID
MATRIX_ACCESS_TOKEN=$BOT_ACCESS_TOKEN
MATRIX_DEVICE_ID=$DEVICE_ID
DSH_NODE_ID=$NODE_ID
EOF
chmod 600 "$OUTPUT"

echo "ok  : bot provisioned"
echo "user_id     : $BOT_USER_ID"
echo "device_id   : $DEVICE_ID"
echo "credentials : $OUTPUT (mode 0600)"