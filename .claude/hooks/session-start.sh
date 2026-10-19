#!/bin/bash
set -euo pipefail

# Only run in Claude Code cloud sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# npm ci keeps the committed lockfile untouched.
npm ci --no-audit --no-fund

# Write .env.local from the environment's variables when they are set.
if [[ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" && -n "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ]]; then
  {
    printf 'NEXT_PUBLIC_SUPABASE_URL=%s\n' "$NEXT_PUBLIC_SUPABASE_URL"
    printf 'NEXT_PUBLIC_SUPABASE_ANON_KEY=%s\n' "$NEXT_PUBLIC_SUPABASE_ANON_KEY"
    if [[ -n "${NEXT_PUBLIC_MANAGER_PHONE:-}" ]]; then
      printf 'NEXT_PUBLIC_MANAGER_PHONE=%s\n' "$NEXT_PUBLIC_MANAGER_PHONE"
    fi
    if [[ -n "${GOOGLE_GENERATIVE_AI_API_KEY:-}" ]]; then
      printf 'GOOGLE_GENERATIVE_AI_API_KEY=%s\n' "$GOOGLE_GENERATIVE_AI_API_KEY"
    fi
  } > .env.local
else
  echo "Supabase keys not set in the environment; the app will start without data access." >&2
fi

# Start the dev server in the background unless it is already up.
if ! curl -sf "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
  nohup npm run dev -- --hostname 0.0.0.0 --port 3000 > /tmp/fleet-ops-dev.log 2>&1 &
fi
