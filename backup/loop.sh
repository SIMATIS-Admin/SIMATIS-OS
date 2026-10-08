#!/bin/sh
# Catch-up rather than fixed schedule: every hour, run what is overdue. A laptop that slept
# through the night backs up as soon as it wakes up.
. /usr/local/bin/common.sh

BACKUP_EVERY=${BACKUP_EVERY_SECONDS:-86400}
RESTORE_EVERY=${RESTORE_TEST_EVERY_SECONDS:-604800}
CHECK_EVERY=${CHECK_EVERY_SECONDS:-3600}

while true; do
  if [ "$(age_seconds "$(status_field lastBackupAt)")" -ge "$BACKUP_EVERY" ]; then
    backup.sh || true
  fi
  if [ "$(age_seconds "$(status_field lastBackupAt)")" -lt "$BACKUP_EVERY" ] \
    && [ "$(age_seconds "$(status_field lastRestoreTestAt)")" -ge "$RESTORE_EVERY" ]; then
    restore-test.sh || true
  fi
  sleep "$CHECK_EVERY"
done
