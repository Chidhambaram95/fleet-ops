#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

npm ci

if [[ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" || -z "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ]]; then
  echo "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in environment secrets." >&2
  exit 1
fi

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
