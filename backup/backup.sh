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
# Temporary switch for a host that cannot read the secrets files (I/O errors on the bind mount):
# the database is still saved and /health keeps a warning until the switch is removed.
sans_secrets=""
if [ "${BACKUP_SANS_SECRETS:-}" = "oui" ]; then
  sans_secrets="Sauvegarde SANS les secrets (BACKUP_SANS_SECRETS=oui) : à rétablir"
elif [ -d /secrets ]; then
  paths="$paths /secrets"
fi
# shellcheck disable=SC2086
restic backup --host simatis-os --tag simatis $paths || fail "restic backup"
restic forget --host simatis-os --tag simatis --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune \
  || fail "restic forget"
rm -rf "$DUMP_DIR"

write_status "$started" "$restore_at" true "$sans_secrets"
echo "backup ok: $started"
