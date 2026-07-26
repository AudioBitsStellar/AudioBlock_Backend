#!/bin/bash
set -e
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR=${BACKUP_DIR:-"backups"}
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.sql.gz"
echo "Creating backup $BACKUP_FILE..."
pg_dump -U ${DB_USER:-postgres} -h ${DB_HOST:-localhost} -p ${DB_PORT:-5432} ${DB_NAME:-audioblock} | gzip > "$BACKUP_FILE"
echo "Validating backup checksum..."
sha256sum "$BACKUP_FILE" > "${BACKUP_FILE}.sha256"
echo "Backup created successfully: $BACKUP_FILE"
