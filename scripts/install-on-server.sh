#!/usr/bin/env bash
# Copy/run on the target host
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[earthlink] installing in $ROOT"
if ! command -v node >/dev/null; then
  echo "Node.js 20+ required" >&2
  exit 1
fi
if ! command -v ss >/dev/null && ! command -v netstat >/dev/null; then
  echo "Need ss or netstat (iproute2 / net-tools)" >&2
  exit 1
fi

npm install
npm run build

echo
echo "[earthlink] start with:"
echo "  HOST=0.0.0.0 PORT=8080 npm start"
echo
echo "Or install systemd unit — see INSTALL.md"
echo "UI: http://$(hostname -I 2>/dev/null | awk '{print $1}'):8080"
