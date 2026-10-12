#!/usr/bin/env bash
# Starts a throwaway local PostgreSQL 16 cluster for DB integration tests (no Docker needed).
# Usage: npm run db:local   then   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres npm run test:db
set -euo pipefail
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="${PGDATA_DIR:-$(pwd)/.pgdata}"
PORT="${PGPORT_TEST:-54329}"
RUNAS=()
if [ "$(id -u)" = "0" ]; then RUNAS=(runuser -u postgres --); mkdir -p "$DATA"; chown postgres "$DATA"; fi
if [ ! -f "$DATA/PG_VERSION" ]; then
  echo postgres > /tmp/loop-pgpass && chmod 644 /tmp/loop-pgpass
  "${RUNAS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres --pwfile=/tmp/loop-pgpass -A scram-sha-256 >/dev/null
  rm -f /tmp/loop-pgpass
fi
if ! "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$DATA/server.log" start >/dev/null
fi
echo "PostgreSQL ready on 127.0.0.1:$PORT (user postgres / password postgres)"
