#!/usr/bin/env bash
# Throwaway local Postgres for tests (no Docker needed). Data lives in backend/.pgdata (git-ignored).
# CI uses a postgres service container instead.
set -euo pipefail
cd "$(dirname "$0")/.."
DATA=".pgdata"
PORT="${TEST_PG_PORT:-55433}"
BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl)")}"

case "${1:-start}" in
  start)
    if [ ! -d "$DATA" ]; then
      LC_ALL=C "$BIN/initdb" -D "$DATA" -U postgres --auth=trust --locale=C -E UTF8 >/dev/null
    fi
    LC_ALL=en_US.UTF-8 "$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$DATA/log.txt" -w start >/dev/null
    echo "postgres running on 127.0.0.1:$PORT (trust auth, test only)"
    ;;
  stop)
    "$BIN/pg_ctl" -D "$DATA" -w stop >/dev/null && echo "stopped"
    ;;
  *) echo "usage: $0 start|stop"; exit 2 ;;
esac
