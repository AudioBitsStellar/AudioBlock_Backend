#!/bin/bash
#
# Restore drill (OPS-08 / Issue #968).
#
# Proves the automated backup is actually restorable, and records the numbers
# an incident reviewer needs: how long the dump and the restore took, whether
# every row survived byte-for-byte, and how that compares to the RPO/RTO the
# runbook promises.
#
# It never touches an existing database: it creates two throwaway databases
# (source + restored), seeds the source with the tables the runbook verifies,
# runs the *real* scripts/backup.sh and scripts/restore.sh against them, and
# drops both unless --keep is given.
#
# Usage:
#   scripts/restore-drill.sh [--postgres-url URL] [--record PATH]
#                            [--rto-target-seconds N] [--keep]
#
# The URL must be a superuser/maintenance connection (CREATE DATABASE rights),
# e.g. postgres://postgres:postgres@localhost:5432/postgres
set -euo pipefail

PGURL=${PGURL:-postgres://postgres:postgres@localhost:5432/postgres}
RECORD=""
RTO_TARGET_SECONDS=1800
KEEP=0

while [ $# -gt 0 ]; do
  case "$1" in
    --postgres-url) PGURL="$2"; shift 2 ;;
    --record) RECORD="$2"; shift 2 ;;
    --rto-target-seconds) RTO_TARGET_SECONDS="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
STAMP=$(date +%Y%m%d_%H%M%S)
SRC_DB="audioblocks_drill_src_${STAMP}"
DST_DB="audioblocks_drill_restored_${STAMP}"
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/audioblocks-drill.XXXXXX")

cleanup() {
  if [ "$KEEP" -eq 0 ]; then
    PGPASSWORD=$DRILL_PASSWORD psql -h "$DRILL_HOST" -p "$DRILL_PORT" -U "$DRILL_USER" \
      -d "$DRILL_MAINT_DB" -v ON_ERROR_STOP=1 -q \
      -c "DROP DATABASE IF EXISTS \"$SRC_DB\";" \
      -c "DROP DATABASE IF EXISTS \"$DST_DB\";" >/dev/null 2>&1 || true
    rm -rf "$WORK_DIR"
  else
    echo "Kept scratch databases: $SRC_DB, $DST_DB (work dir $WORK_DIR)"
  fi
}
trap cleanup EXIT

# Connection pieces for backup.sh / restore.sh (they take DB_* env vars).
eval "$(node -e '
  const u = new URL(process.argv[1]);
  const q = (k, d) => process.env[k] || d;
  console.log(`DRILL_HOST=${u.hostname}`);
  console.log(`DRILL_PORT=${u.port || "5432"}`);
  console.log(`DRILL_USER=${decodeURIComponent(u.username || "postgres")}`);
  console.log(`DRILL_PASSWORD=${decodeURIComponent(u.password || "")}`);
  console.log(`DRILL_MAINT_DB=${decodeURIComponent(u.pathname.replace(/^\//, "") || "postgres")}`);
' "$PGURL")"

run_psql() { # run_psql <db> <sql>
  PGPASSWORD=$DRILL_PASSWORD psql -h "$DRILL_HOST" -p "$DRILL_PORT" -U "$DRILL_USER" \
    -d "$1" -v ON_ERROR_STOP=1 -q -c "$2"
}

echo "==> Creating scratch databases"
run_psql "$DRILL_MAINT_DB" "CREATE DATABASE \"$SRC_DB\";"
run_psql "$DRILL_MAINT_DB" "CREATE DATABASE \"$DST_DB\";"

echo "==> Seeding source database"
SEED_SQL=$(cat <<'SQL'
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE songs (
  id bigserial PRIMARY KEY,
  title text NOT NULL,
  status text NOT NULL,
  metadata_cid text
);
CREATE TABLE genres (id serial PRIMARY KEY, name text NOT NULL UNIQUE);
CREATE TABLE indexed_events (
  id bigserial PRIMARY KEY,
  contract_id text NOT NULL,
  ledger bigint NOT NULL,
  transaction_hash text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL
);
CREATE TABLE indexer_cursors (
  contract_id text NOT NULL,
  network text NOT NULL,
  last_processed_ledger bigint NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (contract_id, network)
);

INSERT INTO genres (name)
  SELECT 'genre-' || g FROM generate_series(1, 25) g;
INSERT INTO users (id, email, role, created_at)
  SELECT gen_random_uuid(), 'user-' || g || '@drill.test',
         CASE WHEN g % 7 = 0 THEN 'artist' ELSE 'listener' END,
         now() - (g || ' minutes')::interval
  FROM generate_series(1, 500) g;
INSERT INTO songs (title, status, metadata_cid)
  SELECT 'song-' || g, CASE WHEN g % 3 = 0 THEN 'ready' ELSE 'processing' END,
         'bafy' || md5(g::text)
  FROM generate_series(1, 1000) g;
INSERT INTO indexed_events (contract_id, ledger, transaction_hash, event_type, payload)
  SELECT 'CDRILL' || (g % 5), 1000000 + g, md5('tx' || g), 'transfer',
         jsonb_build_object('amount', g, 'asset', 'XLM')
  FROM generate_series(1, 2000) g;
INSERT INTO indexer_cursors (contract_id, network, last_processed_ledger, updated_at)
  SELECT 'CDRILL' || c, 'testnet', 1002000 + c, now()
  FROM generate_series(0, 4) c;
SQL
)
run_psql "$SRC_DB" "$SEED_SQL"

# Logical fingerprint per table: catches dropped rows, reordered content,
# truncated text and lost jsonb keys in one comparison per table.
fingerprint() { # fingerprint <db>
  local db="$1"
  for table in users songs genres indexed_events indexer_cursors; do
    PGPASSWORD=$DRILL_PASSWORD psql -h "$DRILL_HOST" -p "$DRILL_PORT" -U "$DRILL_USER" \
      -d "$db" -v ON_ERROR_STOP=1 -q -t -A -c \
      "SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) || ' ' || count(*) FROM $table t;" \
      | sed "s/^/$table /"
  done
}

# Millisecond clock: `date +%s` is second-granular on BSD/macOS, which would
# report a small drill as "0s" and hide real regressions.
now_ms() { node -e 'process.stdout.write(String(Date.now()))'; }

echo "==> Running scripts/backup.sh"
BACKUP_START=$(now_ms)
BACKUP_RETENTION_DAYS=7 \
BACKUP_DIR="$WORK_DIR" \
DB_USER="$DRILL_USER" DB_HOST="$DRILL_HOST" DB_PORT="$DRILL_PORT" DB_NAME="$SRC_DB" \
POSTGRES_PASSWORD="$DRILL_PASSWORD" \
  bash "$REPO_ROOT/scripts/backup.sh" > "$WORK_DIR/backup.log"
BACKUP_MS=$(( $(now_ms) - BACKUP_START ))
BACKUP_SECONDS=$(awk "BEGIN { printf \"%.2f\", $BACKUP_MS / 1000 }")
BACKUP_FILE=$(sed -n 's/^BACKUP_FILE=//p' "$WORK_DIR/backup.log")
if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "FAIL: backup.sh produced no readable dump" >&2
  exit 1
fi
BACKUP_BYTES=$(wc -c < "$BACKUP_FILE" | tr -d ' ')

echo "==> Running scripts/restore.sh"
RESTORE_START=$(now_ms)
DB_USER="$DRILL_USER" DB_HOST="$DRILL_HOST" DB_PORT="$DRILL_PORT" DB_NAME="$DST_DB" \
POSTGRES_PASSWORD="$DRILL_PASSWORD" \
  bash "$REPO_ROOT/scripts/restore.sh" "$BACKUP_FILE" > "$WORK_DIR/restore.log"
RESTORE_MS=$(( $(now_ms) - RESTORE_START ))
RESTORE_SECONDS=$(awk "BEGIN { printf \"%.2f\", $RESTORE_MS / 1000 }")

echo "==> Comparing fingerprints"
fingerprint "$SRC_DB" > "$WORK_DIR/src.fp"
fingerprint "$DST_DB" > "$WORK_DIR/dst.fp"
if ! diff -u "$WORK_DIR/src.fp" "$WORK_DIR/dst.fp" > "$WORK_DIR/fp.diff"; then
  echo "FAIL: restored database differs from the source" >&2
  cat "$WORK_DIR/fp.diff" >&2
  exit 1
fi

TOTAL_ROWS=$(awk '{s += $3} END {print s}' "$WORK_DIR/src.fp")
RTO_STATUS="PASS"
if [ "$RESTORE_MS" -gt $(( RTO_TARGET_SECONDS * 1000 )) ]; then
  RTO_STATUS="FAIL"
fi

RESULT="PASS"
if [ "$RTO_STATUS" = "FAIL" ]; then RESULT="FAIL"; fi

echo "==> Drill result: $RESULT (backup ${BACKUP_SECONDS}s, restore ${RESTORE_SECONDS}s, ${TOTAL_ROWS} rows identical)"

if [ -n "$RECORD" ]; then
  mkdir -p "$(dirname "$RECORD")"
  TABLES_MD=$(awk '{printf "| `%s` | %s | `%s` |\n", $1, $3, substr($2,1,12)}' "$WORK_DIR/src.fp")
  cat > "$RECORD" <<MD
# Restore drill record

**Result:** ${RESULT}
**Run at:** $(date -u +%Y-%m-%dT%H:%M:%SZ)
**Host:** $(uname -srm)
**Postgres:** $(PGPASSWORD=$DRILL_PASSWORD psql -h "$DRILL_HOST" -p "$DRILL_PORT" -U "$DRILL_USER" -d "$DRILL_MAINT_DB" -t -A -c 'SHOW server_version')
**Scripts:** \`scripts/backup.sh\` → \`scripts/restore.sh\` (the scheduled path, not a hand-written equivalent)
**Dataset:** drill-sized (${TOTAL_ROWS} rows across five tables). Timings prove the
path and the checks, not production throughput — repeat against a production-sized
copy before quoting an RTO for a large database.

## Measured

| Step | Value |
| :--- | :--- |
| Backup (pg_dump + gzip + sha256 verify) | ${BACKUP_SECONDS}s |
| Restore (gunzip + psql) | ${RESTORE_SECONDS}s |
| Dump size | ${BACKUP_BYTES} bytes |
| Rows compared | ${TOTAL_ROWS} |
| RTO target / measured | ${RTO_TARGET_SECONDS}s / ${RESTORE_SECONDS}s (${RTO_STATUS}) |
| RPO | ≤ 24 h — daily backup job (\`database_backup\`, \`SCHED_DB_BACKUP_MS\` / 02:00 UTC cron) |

## Fidelity

Every table matched on both row count and an ordered md5 of all row values:

| Table | Rows | Content md5 (12 chars) |
| :--- | :--- | :--- |
${TABLES_MD}

Scratch databases were dropped after the comparison; rerun with \`--record\` to
refresh this file and with \`--keep\` to inspect them.
MD
  echo "==> Record written to $RECORD"
fi

[ "$RESULT" = "PASS" ]
