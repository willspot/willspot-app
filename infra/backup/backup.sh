#!/bin/sh
# Encrypted logical backups of every WillSpot database.
#
#   BACKUP_DATABASES="identity wallet trade config giftcards bills risk notifications"
#   <NAME>_DATABASE_URL       one per database (use a read-only backup role)
#   BACKUP_DEST               s3://bucket/prefix  or  file:///absolute/path
#   BACKUP_AGE_RECIPIENTS     file of age public keys (one per line). The private key is
#                             kept OFFLINE; this job can encrypt but never decrypt.
#   BACKUP_ALLOW_UNENCRYPTED  1 = allow plain dumps (local testing only)
#   BACKUP_S3_ENDPOINT        S3-compatible endpoint (an in-country object store; ADR-008/data residency)
#
# Output per run: <dest>/<stamp>/<name>.dump[.age] plus manifest.json with sizes and SHA-256.
set -eu

: "${BACKUP_DATABASES:?set BACKUP_DATABASES}"
: "${BACKUP_DEST:?set BACKUP_DEST}"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077

if [ -n "${BACKUP_AGE_RECIPIENTS:-}" ]; then
  encrypt=1
elif [ "${BACKUP_ALLOW_UNENCRYPTED:-0}" = "1" ]; then
  encrypt=0
  echo "WARNING: writing UNENCRYPTED backups (BACKUP_ALLOW_UNENCRYPTED=1)" >&2
else
  echo "Refusing to run: set BACKUP_AGE_RECIPIENTS (or BACKUP_ALLOW_UNENCRYPTED=1 for local tests)" >&2
  exit 2
fi

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

put() { # put <local file> <relative key>
  case "$BACKUP_DEST" in
    s3://*) aws s3 cp --only-show-errors ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} "$1" "${BACKUP_DEST%/}/$2" ;;
    file://*) d="${BACKUP_DEST#file://}"; mkdir -p "$(dirname "$d/$2")"; cp "$1" "$d/$2" ;;
    *) echo "BACKUP_DEST must start with s3:// or file://" >&2; exit 2 ;;
  esac
}

entries=""
for name in $BACKUP_DATABASES; do
  var=$(echo "$name" | tr '[:lower:]' '[:upper:]')_DATABASE_URL
  url=$(printenv "$var" || true)
  [ -n "$url" ] || { echo "missing $var" >&2; exit 2; }
  file="$work/$name.dump"
  started=$(date +%s)
  # Custom format: compressed, restorable table by table, consistent snapshot of one database.
  pg_dump --format=custom --compress=6 --no-owner --no-privileges --dbname="$url" --file="$file"
  if [ "$encrypt" = "1" ]; then
    age --encrypt -R "$BACKUP_AGE_RECIPIENTS" -o "$file.age" "$file"
    rm -f "$file"
    file="$file.age"
  fi
  size=$(wc -c < "$file" | tr -d ' ')
  digest=$(sha "$file")
  put "$file" "$stamp/$(basename "$file")"
  echo "backed up $name: $size bytes in $(( $(date +%s) - started ))s"
  entries="$entries${entries:+,}{\"database\":\"$name\",\"file\":\"$(basename "$file")\",\"bytes\":$size,\"sha256\":\"$digest\"}"
done

printf '{"stamp":"%s","encrypted":%s,"databases":[%s]}\n' "$stamp" "$([ "$encrypt" = 1 ] && echo true || echo false)" "$entries" > "$work/manifest.json"
put "$work/manifest.json" "$stamp/manifest.json"
# Pointer to the newest complete set (written last, so a half-finished run is never "latest").
echo "$stamp" > "$work/LATEST"
put "$work/LATEST" "LATEST"
echo "backup $stamp complete"
