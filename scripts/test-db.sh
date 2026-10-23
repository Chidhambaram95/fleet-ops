#!/usr/bin/env bash
# Runs the database checks in supabase/tests against DATABASE_URL.
# Use a local or test Supabase database that already has every migration,
# never the live one. Each file rolls back, so no data is left behind.
#
#   DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres npm run test:db
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Set DATABASE_URL to a test database first." >&2
  exit 1
fi

cd "$(dirname "$0")/.."
status=0
for file in supabase/tests/*.test.sql; do
  echo "== ${file}"
  if ! psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f "$file"; then
    status=1
  fi
done
exit "$status"
