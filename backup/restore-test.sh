#!/bin/sh
# Restores the latest snapshot into a throwaway database and checks it holds data.
. /usr/local/bin/common.sh

backup_at=$(status_field lastBackupAt)
target=/tmp/simatis-restore
scratch="restore_test_$(date -u +%Y%m%d%H%M%S)"

fail() {
  dropdb --if-exists "$scratch" 2> /dev/null || true
  rm -rf "$target"
  write_status "$backup_at" "$(status_field lastRestoreTestAt)" false "Test de restauration échoué : $1"
  echo "restore test failed: $1" >&2
  exit 1
}

rm -rf "$target"
restic restore latest --host simatis-os --tag simatis --target "$target" --include "$DUMP_DIR/simatis.dump" \
  || fail "restic restore"
createdb "$scratch" || fail "createdb"
pg_restore --no-owner --no-privileges --dbname="$scratch" "$target$DUMP_DIR/simatis.dump" \
  || fail "pg_restore"
count=$(psql --dbname="$scratch" -tAc 'select count(*) from instances') || fail "lecture"
[ "$count" -gt 0 ] || fail "aucune instance dans la copie restaurée"
dropdb "$scratch"
rm -rf "$target"

write_status "$backup_at" "$(now_iso)" true ""
echo "restore test ok: $count instances"
