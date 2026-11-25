#!/bin/bash
#
# Restore a logical backup produced by scripts/backup.sh.
#
# Environment (same contract as backup.sh):
#   DB_USER / DB_HOST / DB_PORT / DB_NAME   target connection
#   POSTGRES_PASSWORD                        used as PGPASSWORD when set
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <backup_file.sql.gz>"
  exit 1
fi
BACKUP_FILE="$1"
if [ ! -f "$BACKUP_FILE" ]; then
  echo "File not found: $BACKUP_FILE"
  exit 1
fi

if [ -n "${POSTGRES_PASSWORD:-}" ]; then
  export PGPASSWORD="$POSTGRES_PASSWORD"
fi

if [ -f "${BACKUP_FILE}.sha256" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "${BACKUP_FILE}.sha256" > /dev/null
  else
    shasum -a 256 -c "${BACKUP_FILE}.sha256" > /dev/null
  fi
  echo "Checksum verified for $BACKUP_FILE"
fi

echo "Restoring from $BACKUP_FILE..."
gunzip -c "$BACKUP_FILE" | psql -v ON_ERROR_STOP=1 \
  -U "${DB_USER:-postgres}" \
  -h "${DB_HOST:-localhost}" \
  -p "${DB_PORT:-5432}" \
  "${DB_NAME:-audioblocks}"
echo "Restore completed successfully."
