#!/usr/bin/env bash
# Earthlink edge agent — macOS
# Usage:
#   export EARTHLINK_HUB=http://10.11.12.62:8080
#   export EARTHLINK_HOST_ID=macbook
#   export EARTHLINK_AGENT_TOKEN=change-me
#   bash agents/run-macos.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${EARTHLINK_HUB:-}" ]]; then
  echo "Set EARTHLINK_HUB=http://HUB_IP:8080" >&2
  exit 1
fi

export EARTHLINK_HOST_ID="${EARTHLINK_HOST_ID:-$(scutil --get LocalHostName 2>/dev/null || hostname -s || echo macbook)}"
export EARTHLINK_POLL_MS="${EARTHLINK_POLL_MS:-2000}"

echo "[run-macos] hub=$EARTHLINK_HUB hostId=$EARTHLINK_HOST_ID"
exec node "$ROOT/agents/earthlink-agent.mjs"
