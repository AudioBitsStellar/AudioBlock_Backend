#!/bin/bash
set -e
if [ -z "$1" ]; then
  echo "Usage: $0 <backup_file.sql.gz>"
  exit 1
fi
BACKUP_FILE="$1"
if [ ! -f "$BACKUP_FILE" ]; then
  echo "File not found: $BACKUP_FILE"
  exit 1
fi
echo "Restoring from $BACKUP_FILE..."
gunzip -c "$BACKUP_FILE" | psql -U ${DB_USER:-postgres} -h ${DB_HOST:-localhost} -p ${DB_PORT:-5432} ${DB_NAME:-audioblock}
echo "Restore completed successfully."
