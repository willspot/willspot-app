#!/bin/sh
# Restore drill: proves the latest backup can be restored and is internally consistent.
# Restores every database into throwaway "drill_*" databases, checks them, records how
# long it took, and drops them. Run it on a schedule against a NON-production server.
#
#   BACKUP_SOURCE           s3://bucket/prefix or file:///absolute/path (same as BACKUP_DEST)
#   BACKUP_STAMP            optional; defaults to the LATEST pointer
#   BACKUP_AGE_IDENTITY     file with the age private key (only on the drill runner)
#   DRILL_ADMIN_URL         postgres URL of a role that may CREATE/DROP DATABASE (scratch server)
#   DRILL_KEEP=1            keep the restored databases for inspection
#
# Exit code 0 = every check passed. Prints a JSON report on the last line.
set -eu
: "${BACKUP_SOURCE:?set BACKUP_SOURCE}"
: "${DRILL_ADMIN_URL:?set DRILL_ADMIN_URL}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077

get() { # get <relative key> <local file>
  case "$BACKUP_SOURCE" in
    s3://*) aws s3 cp --only-show-errors ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} "${BACKUP_SOURCE%/}/$1" "$2" ;;
    file://*) cp "${BACKUP_SOURCE#file://}/$1" "$2" ;;
  esac
}
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
db_url() { # replace the database name in DRILL_ADMIN_URL
  echo "$DRILL_ADMIN_URL" | sed -E "s#^(postgres(ql)?://[^/]+)/[^?]*#\\1/$1#"
}
q() { PGOPTIONS="-c client_min_messages=warning" psql -X -q -t -A -v ON_ERROR_STOP=1 --dbname="$1" -c "$2"; }

if [ -z "${BACKUP_STAMP:-}" ]; then get LATEST "$work/LATEST"; BACKUP_STAMP=$(cat "$work/LATEST"); fi
get "$BACKUP_STAMP/manifest.json" "$work/manifest.json"
started=$(date +%s)
failures=0
report=""
fail() { echo "FAIL $1" >&2; failures=$((failures + 1)); }

# Parse the manifest without jq (busybox-friendly): one entry per line.
tr '{' '\n' < "$work/manifest.json" | grep '"database"' | while IFS= read -r line; do echo "$line"; done > "$work/entries"

suffix=$(echo "$BACKUP_STAMP" | tr '[:upper:]' '[:lower:]')
while IFS= read -r e; do
  name=$(echo "$e" | sed -E 's/.*"database":"([^"]+)".*/\1/')
  file=$(echo "$e" | sed -E 's/.*"file":"([^"]+)".*/\1/')
  want=$(echo "$e" | sed -E 's/.*"sha256":"([^"]+)".*/\1/')
  get "$BACKUP_STAMP/$file" "$work/$file"
  [ "$(sha "$work/$file")" = "$want" ] || { fail "$name: checksum mismatch"; continue; }
  dump="$work/$file"
  case "$file" in
    *.age)
      : "${BACKUP_AGE_IDENTITY:?encrypted backup: set BACKUP_AGE_IDENTITY}"
      age --decrypt -i "$BACKUP_AGE_IDENTITY" -o "$work/$name.dump" "$dump"
      dump="$work/$name.dump" ;;
  esac
  target="drill_${name}_${suffix}"
  q "$DRILL_ADMIN_URL" "DROP DATABASE IF EXISTS $target" >/dev/null
  q "$DRILL_ADMIN_URL" "CREATE DATABASE $target" >/dev/null
  t0=$(date +%s)
  if ! pg_restore --no-owner --no-privileges --exit-on-error --dbname="$(db_url "$target")" "$dump"; then
    fail "$name: pg_restore failed"; continue
  fi
  url=$(db_url "$target")
  tables=$(q "$url" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
  migrations=$(q "$url" "SELECT count(*) FROM schema_migrations")
  [ "$migrations" -gt 0 ] || fail "$name: no applied migrations recorded"
  extra=""
  if [ "$name" = "wallet" ]; then
    # The ledger must still balance: every asset nets to zero, every journal balances,
    # and each cached balance equals the sum of its postings.
    drift=$(q "$url" "SELECT count(*) FROM (SELECT a.asset FROM postings p JOIN ledger_accounts a ON a.id=p.account_id GROUP BY a.asset HAVING sum(p.amount) <> 0) x")
    unbalanced=$(q "$url" "SELECT count(*) FROM (SELECT journal_id FROM postings GROUP BY journal_id HAVING sum(amount) <> 0) x")
    mismatched=$(q "$url" "SELECT count(*) FROM balances b LEFT JOIN (SELECT account_id, sum(amount) s FROM postings GROUP BY account_id) p USING (account_id) WHERE b.balance <> coalesce(p.s, 0)")
    journals=$(q "$url" "SELECT count(*) FROM journals")
    [ "$drift" = 0 ] || fail "wallet: $drift asset(s) do not net to zero"
    [ "$unbalanced" = 0 ] || fail "wallet: $unbalanced unbalanced journal(s)"
    [ "$mismatched" = 0 ] || fail "wallet: $mismatched balance(s) differ from postings"
    extra=",\"journals\":$journals,\"assetDrift\":$drift,\"unbalancedJournals\":$unbalanced,\"balanceMismatches\":$mismatched"
  fi
  echo "restored $name: $tables tables, $migrations migrations in $(( $(date +%s) - t0 ))s"
  report="$report${report:+,}{\"database\":\"$name\",\"tables\":$tables,\"migrations\":$migrations,\"restoreSeconds\":$(( $(date +%s) - t0 ))$extra}"
  if [ "${DRILL_KEEP:-0}" != "1" ]; then q "$DRILL_ADMIN_URL" "DROP DATABASE $target WITH (FORCE)" >/dev/null; fi
done < "$work/entries"

total=$(( $(date +%s) - started ))
ok=$([ "$failures" = 0 ] && echo true || echo false)
printf '{"stamp":"%s","ok":%s,"failures":%s,"totalSeconds":%s,"databases":[%s]}\n' "$BACKUP_STAMP" "$ok" "$failures" "$total" "$report"
[ "$failures" = 0 ]
