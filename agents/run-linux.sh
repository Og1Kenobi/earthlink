#!/usr/bin/env bash
# Earthlink edge agent — Linux
# Usage:
#   export EARTHLINK_HUB=http://10.11.12.62:8080
#   export EARTHLINK_HOST_ID=edge-linux-1
#   export EARTHLINK_AGENT_TOKEN=change-me
#   bash agents/run-linux.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${EARTHLINK_HUB:-}" ]]; then
  echo "Set EARTHLINK_HUB=http://HUB_IP:8080" >&2
  exit 1
fi

export EARTHLINK_HOST_ID="${EARTHLINK_HOST_ID:-$(hostname -s 2>/dev/null || hostname || echo edge-linux)}"
export EARTHLINK_POLL_MS="${EARTHLINK_POLL_MS:-2000}"

echo "[run-linux] hub=$EARTHLINK_HUB hostId=$EARTHLINK_HOST_ID"
exec node "$ROOT/agents/earthlink-agent.mjs"
