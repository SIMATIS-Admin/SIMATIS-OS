#!/bin/sh
# Shared settings and status helpers for the backup scripts.
set -eu

STATUS_DIR=${STATUS_DIR:-/status}
STATUS_FILE="$STATUS_DIR/last.json"
DUMP_DIR=/tmp/simatis-dump
export PGHOST=${PGHOST:-db}
export PGUSER=${POSTGRES_USER:-simatis}
export PGPASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD manquant}
export PGDATABASE=${POSTGRES_DB:-simatis}
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY manquant}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD manquant}"

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Reads one field of the status file (empty if absent).
status_field() {
  [ -f "$STATUS_FILE" ] || return 0
  sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$STATUS_FILE"
}

# Writes the status file atomically: the app reads it to display the last backup on /health.
write_status() {
  mkdir -p "$STATUS_DIR"
  backup_at=$1 restore_at=$2 ok=$3 error=$4
  tmp="$STATUS_FILE.tmp"
  {
    printf '{\n'
    printf '  "lastBackupAt": %s,\n' "$( [ -n "$backup_at" ] && printf '"%s"' "$backup_at" || printf null )"
    printf '  "lastRestoreTestAt": %s,\n' "$( [ -n "$restore_at" ] && printf '"%s"' "$restore_at" || printf null )"
    printf '  "ok": %s,\n' "$ok"
    printf '  "lastError": %s\n' "$( [ -n "$error" ] && printf '"%s"' "$(printf %s "$error" | tr -d '"\\\n')" || printf null )"
    printf '}\n'
  } > "$tmp"
  mv "$tmp" "$STATUS_FILE"
}

ensure_repository() {
  restic cat config > /dev/null 2>&1 || restic init
}

# Age in seconds of an ISO timestamp (huge when empty, so the action is due).
age_seconds() {
  [ -n "$1" ] || { echo 999999999; return; }
  then=$(date -u -d "$(echo "$1" | sed 's/T/ /; s/Z$//')" +%s 2> /dev/null || echo 0)
  echo $(( $(date -u +%s) - then ))
}
