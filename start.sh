#!/usr/bin/env bash
# =============================================================================
#  elsba3ei Webhook & SSRF Inspector - Linux / macOS Launcher
# =============================================================================

set -e

# Change to script directory
cd "$(dirname "$0")"

PORT="${PORT:-4000}"
TUNNEL_FLAG=""

# Check arguments
for arg in "$@"; do
  if [ "$arg" == "--tunnel" ]; then
    TUNNEL_FLAG="--tunnel"
  elif [[ "$arg" =~ ^[0-9]+$ ]]; then
    PORT="$arg"
  fi
done

echo -e "\033[1;36m========================================================\033[0m"
echo -e "\033[1;32m  🎯 Starting elsba3ei Webhook & SSRF Inspector...\033[0m"
echo -e "\033[1;36m========================================================\033[0m"
echo -e "\033[1;33m[*] Local Dashboard: http://localhost:${PORT}\033[0m"

# Open browser in background if GUI is available
(
  sleep 1
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:${PORT}" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "http://localhost:${PORT}" >/dev/null 2>&1 || true
  fi
) &

# Cleanup cloudflared child process on exit
cleanup() {
  echo -e "\n\033[1;33m[i] Stopping background services...\033[0m"
  pkill -P $$ 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Execute Node.js server
exec node server.js "$@"
