#!/usr/bin/env bash
# Usage: PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -qc "drop database if exists nx_test" -c "create database nx_test" >/dev/null
for f in tests/00_supabase_shim.sql migrations/*.sql tests/[1-9]*.sql; do
  if grep -q "@platform-only" "$f"; then echo "skip $f (platform-only)"; continue; fi
  psql -d nx_test -v ON_ERROR_STOP=1 -q -f "$f" 2>&1 | grep -E "ok - |FAIL|ERROR|PASSED" || true
  test "${PIPESTATUS[0]}" -eq 0 || { echo "FAILED in $f"; exit 1; }
done
