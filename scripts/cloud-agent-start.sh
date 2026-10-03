#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env.local ]]; then
  echo ".env.local missing; run cloud-agent-install.sh first." >&2
  exit 1
fi

SESSION_NAME="fleet-ops-dev"
TMUX=(tmux -f /exec-daemon/tmux.portal.conf)

if "${TMUX[@]}" has-session -t "=$SESSION_NAME" 2>/dev/null; then
  exit 0
fi

"${TMUX[@]}" new-session -d -s "$SESSION_NAME" -c "$PWD" -- \
  npm run dev -- --hostname 0.0.0.0 --port 3000

for _ in $(seq 1 90); do
  if curl -sf "http://127.0.0.1:3000/api/health" >/dev/null; then
    exit 0
  fi
  sleep 2
done

echo "Next.js dev server did not become ready on port 3000." >&2
exit 1
