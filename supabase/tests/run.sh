#!/usr/bin/env bash
# Usage: PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run.sh
set -uo pipefail
cd "$(dirname "$0")/.."
psql -qc "drop database if exists nx_test" -c "create database nx_test" >/dev/null
for f in tests/00_supabase_shim.sql migrations/*.sql tests/[1-9]*.sql; do
  if grep -q "@platform-only" "$f"; then echo "skip $f (platform-only)"; continue; fi
  out=$(psql -d nx_test -v ON_ERROR_STOP=1 -q -f "$f" 2>&1); status=$?
  printf '%s\n' "$out" | grep -E "ok - |FAIL|ERROR|PASSED"
  if [ $status -ne 0 ]; then echo "FAILED in $f"; exit 1; fi
done
