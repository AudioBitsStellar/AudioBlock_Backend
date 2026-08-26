#!/usr/bin/env bash
#
# test-migration.sh — Automated migration testing script
#
# Starts a fresh PostgreSQL container, applies all pending migrations,
# verifies the rollback path, and runs the test suite to catch regressions.
#
# Usage:
#   ./scripts/test-migration.sh              # use default port 5433
#   PG_PORT=5434 ./scripts/test-migration.sh  # custom port
#
# The script exits with 0 on success, non-zero on failure.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="${SCRIPT_DIR}/src/migrations"
CONTAINER_NAME="audioblocks-migration-test"
PG_PORT="${PG_PORT:-5433}"
PG_USER="postgres"
PG_PASS="migration_test"
PG_DB="audioblocks_test"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

cleanup() {
  info "Cleaning up test container..."
  docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
}

trap cleanup EXIT

# ──────────────────────────────────────────────
# Step 0: Build the project
# ──────────────────────────────────────────────
info "Building TypeScript..."
cd "$SCRIPT_DIR"
npm run build 2>/dev/null || fail "TypeScript build failed"
pass "TypeScript compiled"

# ──────────────────────────────────────────────
# Step 1: Start fresh PostgreSQL
# ──────────────────────────────────────────────
info "Starting PostgreSQL test container on port ${PG_PORT}..."

cleanup

docker run -d \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_USER="$PG_USER" \
  -e POSTGRES_PASSWORD="$PG_PASS" \
  -e POSTGRES_DB="$PG_DB" \
  -p "${PG_PORT}:5432" \
  postgres:15-alpine \
  -c fsync=off \
  -c full_page_writes=off \
  -c log_statement=none \
  > /dev/null

info "Waiting for PostgreSQL to be ready..."
for i in $(seq 1 30); do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$PG_USER" -d "$PG_DB" > /dev/null 2>&1; then
    pass "PostgreSQL is ready"
    break
  fi
  sleep 1
done

# ──────────────────────────────────────────────
# Step 2: Run migrations forward
# ──────────────────────────────────────────────
info "Applying migrations..."
POSTGRES_HOST=localhost \
POSTGRES_PORT="$PG_PORT" \
POSTGRES_USER="$PG_USER" \
POSTGRES_PASSWORD="$PG_PASS" \
POSTGRES_DATABASE="$PG_DB" \
NODE_ENV=test \
npx typeorm migration:run -d dist/config/db.js 2>&1 | tail -5

MIGRATIONS_APPLIED=$(docker exec "$CONTAINER_NAME" psql -U "$PG_USER" -d "$PG_DB" -t -c "SELECT count(*) FROM migrations;" | tr -d ' ')
if [ "$MIGRATIONS_APPLIED" -eq 0 ]; then
  fail "No migrations were applied"
fi
pass "${MIGRATIONS_APPLIED} migration(s) applied"

# Count tables to verify schema
TABLE_COUNT=$(docker exec "$CONTAINER_NAME" psql -U "$PG_USER" -d "$PG_DB" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" | tr -d ' ')
if [ "$TABLE_COUNT" -eq 0 ]; then
  fail "No tables found after migration"
fi
pass "${TABLE_COUNT} table(s) created"

# ──────────────────────────────────────────────
# Step 3: Verify rollback
# ──────────────────────────────────────────────
info "Testing rollback..."
POSTGRES_HOST=localhost \
POSTGRES_PORT="$PG_PORT" \
POSTGRES_USER="$PG_USER" \
POSTGRES_PASSWORD="$PG_PASS" \
POSTGRES_DATABASE="$PG_DB" \
NODE_ENV=test \
npx typeorm migration:revert -d dist/config/db.js 2>&1 | tail -3

MIGRATIONS_AFTER_REVERT=$(docker exec "$CONTAINER_NAME" psql -U "$PG_USER" -d "$PG_DB" -t -c "SELECT count(*) FROM migrations;" | tr -d ' ')
EXPECTED=$((MIGRATIONS_APPLIED - 1))
if [ "$MIGRATIONS_AFTER_REVERT" -ne "$EXPECTED" ]; then
  fail "Rollback did not remove a migration (expected ${EXPECTED}, got ${MIGRATIONS_AFTER_REVERT})"
fi
pass "Rollback removed 1 migration (${MIGRATIONS_AFTER_REVERT} remaining)"

# ──────────────────────────────────────────────
# Step 4: Re-apply to verify re-up
# ──────────────────────────────────────────────
info "Re-applying migrations..."
POSTGRES_HOST=localhost \
POSTGRES_PORT="$PG_PORT" \
POSTGRES_USER="$PG_USER" \
POSTGRES_PASSWORD="$PG_PASS" \
POSTGRES_DATABASE="$PG_DB" \
NODE_ENV=test \
npx typeorm migration:run -d dist/config/db.js 2>&1 | tail -3

MIGRATIONS_REAPPLIED=$(docker exec "$CONTAINER_NAME" psql -U "$PG_USER" -d "$PG_DB" -t -c "SELECT count(*) FROM migrations;" | tr -d ' ')
if [ "$MIGRATIONS_REAPPLIED" -ne "$MIGRATIONS_APPLIED" ]; then
  fail "Re-apply did not restore all migrations (expected ${MIGRATIONS_APPLIED}, got ${MIGRATIONS_REAPPLIED})"
fi
pass "Migrations re-applied successfully (${MIGRATIONS_REAPPLIED})"

# ──────────────────────────────────────────────
# Step 5: Run test suite
# ──────────────────────────────────────────────
info "Running test suite..."
POSTGRES_HOST=localhost \
POSTGRES_PORT="$PG_PORT" \
POSTGRES_USER="$PG_USER" \
POSTGRES_PASSWORD="$PG_PASS" \
POSTGRES_DATABASE="$PG_DB" \
NODE_ENV=test \
npx jest --no-cache --runInBand 2>&1 | tail -5

echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  All migration tests passed successfully  ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
