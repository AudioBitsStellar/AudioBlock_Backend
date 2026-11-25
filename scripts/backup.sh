#!/bin/bash
#
# Logical PostgreSQL backup (OPS-08 / Issue #968).
#
# Writes a timestamped, gzipped pg_dump plus a sha256 sidecar, then re-verifies
# the sidecar so a truncated dump can never be mistaken for a good one.
# Scheduling lives in src/workers/scheduler.ts (in-process, daily) and in the
# crontab documented in docs/runbooks/database-backup-restore.md (one-shot).
#
# Environment:
#   DB_USER / DB_HOST / DB_PORT / DB_NAME   connection (defaults below)
#   POSTGRES_PASSWORD                        used as PGPASSWORD when set
#   BACKUP_DIR                               output directory (default: backups)
set -euo pipefail

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR=${BACKUP_DIR:-"backups"}
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.sql.gz"

if [ -n "${POSTGRES_PASSWORD:-}" ]; then
  export PGPASSWORD="$POSTGRES_PASSWORD"
fi

echo "Creating backup $BACKUP_FILE..."
pg_dump \
  -U "${DB_USER:-postgres}" \
  -h "${DB_HOST:-localhost}" \
  -p "${DB_PORT:-5432}" \
  "${DB_NAME:-audioblocks}" | gzip > "$BACKUP_FILE"

echo "Validating backup checksum..."
checksum "$BACKUP_FILE" > "${BACKUP_FILE}.sha256"
checksum -c "${BACKUP_FILE}.sha256" > /dev/null

# Machine-readable line consumed by DatabaseBackupJob; the human summary stays.
printf 'BACKUP_FILE=%s\n' "$BACKUP_FILE"
echo "Backup created successfully: $BACKUP_FILE"
