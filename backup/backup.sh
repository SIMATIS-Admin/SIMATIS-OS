#!/bin/sh
# One backup: database dump + instance secrets, encrypted by restic, then retention.
. /usr/local/bin/common.sh

restore_at=$(status_field lastRestoreTestAt)
started=$(now_iso)

fail() {
  write_status "$(status_field lastBackupAt)" "$restore_at" false "Sauvegarde échouée ($started) : $1"
  echo "backup failed: $1" >&2
  exit 1
}

ensure_repository || fail "dépôt restic inaccessible"
rm -rf "$DUMP_DIR" && mkdir -p "$DUMP_DIR"
pg_dump --format=custom --file="$DUMP_DIR/simatis.dump" || fail "pg_dump"

paths="$DUMP_DIR"
[ -d /secrets ] && paths="$paths /secrets"
# shellcheck disable=SC2086
restic backup --host simatis-os --tag simatis $paths || fail "restic backup"
restic forget --host simatis-os --tag simatis --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune \
  || fail "restic forget"
rm -rf "$DUMP_DIR"

write_status "$started" "$restore_at" true ""
echo "backup ok: $started"
