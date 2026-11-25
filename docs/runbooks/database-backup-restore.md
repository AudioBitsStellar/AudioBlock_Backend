# Database Backup and Restore Runbook

**Document Owner:** DevOps / Platform Engineering  
**Target Systems:** PostgreSQL 15+ (`AppDataSource`, `audioblocks-db` Docker container, AWS RDS)  
**Last Tested:** 2026-11-23 — automated drill, see [restore-drill-record.md](restore-drill-record.md)  
**RPO Target:** < 24 hours (daily logical dumps) / < 5 minutes (WAL archiving in RDS)  
**RTO Target:** < 30 minutes  

---

## 1. Overview & Scope

The AudioBlocks backend relies on PostgreSQL as its primary transactional datastore for:
- User accounts, roles, wallet addresses, and authentication records (`users`)
- Songs, transcoding status, metadata CIDs, and on-chain token mapping (`songs`)
- Albums, genres, tags, collaborators, and royalty splits
- On-chain event indexer cursors and projection checkpoints (`indexer_cursors`, `projection_checkpoints`, `indexed_events`)
- Audit logs and takedown records (`transaction_logs`, `takedown_requests`)

This runbook specifies the backup schedule, storage architecture, retention rules, and a tested step-by-step restore procedure that an on-call engineer unfamiliar with the system can execute during an incident.

---

## 2. Backup Architecture & Policy

### 2.1 Backup Schedule

| Backup Type | Frequency | Execution Window | Trigger / Mechanism |
| :--- | :--- | :--- | :--- |
| **Automated Logical Backup** | Daily | 02:00 UTC (off-peak) | `database_backup` scheduler job (below) or the cron entry `0 2 * * *` |
| **Continuous WAL Archiving** | Continuous | Real-time | PostgreSQL WAL shipping / RDS automated archiving |
| **Pre-Deployment Backup** | Ad-hoc | Prior to migrations | Manual invocation before `npm run migration:run` |
| **Pre-Incident Backup** | Ad-hoc | Prior to restore attempt | Mandatory safety dump before modifying corrupted DB |

### 2.2 Automated Backup Job (Issue #968)

The daily dump is produced by `src/jobs/DatabaseBackupJob.ts`, which wraps
`scripts/backup.sh` — the same script this runbook asks an on-call engineer to
run by hand, so the scheduled and manual paths cannot drift. The job:

- writes `backup_YYYYMMDD_HHMMSS.sql.gz` plus a `.sha256` sidecar under
  `BACKUP_DIR` (default `./backups`, `/app/backups` in the scheduler container);
- re-reads the dump and fails the run on a missing file, missing sidecar or
  checksum mismatch — a truncated dump is never recorded as a success;
- prunes dumps (and sidecars) older than `BACKUP_RETENTION_DAYS` (default 7).

Two triggers exist, both running that same job:

```bash
# 1. Long-running scheduler deployable (src/workers/scheduler.ts).
#    Runs once at startup and then every SCHED_DB_BACKUP_MS (default 24h).
npm run start:scheduler

# 2. One-shot entrypoint for a Kubernetes CronJob or host cron.
#    Install with `crontab -e` (times are the host's timezone; use UTC hosts):
# 0 2 * * *  cd /opt/audioblocks && set -a && . ./.env && npm run scheduler -- --job=database-backup
```

The scheduler keeps a Redis `SET NX` lock per job, so doubling the pod count
cannot double the backup. Logs are the structured scheduler lines
(`[scheduler] database_backup: done (…ms)`) plus the job's
`Database backup completed and verified` record with file, size and prunes.

### 2.3 Storage Location & Security

- **Storage Target:** Encrypted AWS S3 bucket:  
  `s3://audioblocks-backups-${NODE_ENV}/postgres/YYYY/MM/DD/audioblocks-db-YYYYMMDD_HHMMSS.dump`
- **Encryption:** Server-Side Encryption with AWS KMS (`aws:kms`) or AES-256 (`AES256`).
- **Access Control:** Restricted via IAM; public access blocked. Bucket versioning enabled.
- **Retention Lifecycle:**
  - Daily backups: Retained for **7 days** in S3 Standard.
  - Weekly backups (Sunday): Transitioned to **S3 Glacier Instant Retrieval** for **30 days**.
  - Monthly backups (1st of month): Retained in **S3 Glacier Flexible Retrieval** for **365 days**.

---

## 3. Creating Backups (Procedures)

### 3.1 Docker Compose Environment (Local / Staging)

Run `pg_dump` directly inside the database container using the custom archive format (`-Fc`), which includes compression and supports parallel, selective restores.

```bash
# 1. Generate timestamped backup file
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="audioblocks_backup_${TIMESTAMP}.dump"

# 2. Execute pg_dump inside container
docker exec -t audioblocks-db pg_dump \
  -U postgres \
  -d audioblocks \
  -Fc \
  --blobs \
  --verbose > "${BACKUP_FILE}"

# 3. Verify backup file size is non-zero
ls -lh "${BACKUP_FILE}"
```

### 3.2 Production / Remote PostgreSQL Instance

Using standard PostgreSQL client utilities with environment variables:

```bash
# 1. Load database credentials (or export from .env)
export PGPASSWORD="${POSTGRES_PASSWORD}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="audioblocks_prod_${TIMESTAMP}.dump"

# 2. Execute pg_dump
pg_dump \
  -h "${POSTGRES_HOST}" \
  -p "${POSTGRES_PORT:-5432}" \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DATABASE}" \
  -Fc \
  --blobs \
  --verbose \
  --file="${BACKUP_FILE}"

# 3. Upload to encrypted S3 bucket
aws s3 cp "${BACKUP_FILE}" \
  "s3://${AWS_BUCKET_NAME}-backups/postgres/$(date +%Y/%m/%d)/${BACKUP_FILE}" \
  --sse aws:kms

# 4. Clean up local artifact
rm -f "${BACKUP_FILE}"
```

### 3.3 Validating Backup Integrity

Before attempting a restore, verify that the dump archive is readable and valid:

```bash
pg_restore --list "${BACKUP_FILE}" | head -n 30
```

Expected output: Table definitions, schema TOC entries, and index definitions without errors.

> The automated job writes plain-SQL gzip dumps, so `pg_restore --list` does not
> apply to those files. Verify them with the sidecar instead:
>
> ```bash
> sha256sum -c backup_20261123_020000.sql.gz.sha256   # or: shasum -a 256 -c …
> gunzip -t backup_20261123_020000.sql.gz
> ```

### 3.4 Restoring an Automated Backup

`scripts/restore.sh` restores the `.sql.gz` produced by the job (or by
`npm run db:backup`) into an existing, empty database. It verifies the sidecar
when present and streams through `psql -v ON_ERROR_STOP=1`, so a partial
restore fails the command instead of leaving a half-loaded schema.

```bash
# Against the compose database (DB_* envs default to localhost/postgres/audioblocks)
DB_HOST=localhost DB_PORT=5432 DB_USER=postgres DB_NAME=audioblocks \
POSTGRES_PASSWORD=… \
  npm run db:restore -- backups/backup_20261123_020000.sql.gz
```

Run `scripts/restore-drill.sh` after changing the backup or restore scripts: it
backs up a seeded scratch database with the real scripts, restores it into a
second scratch database, compares every table's row count and an ordered md5 of
all row values, and rewrites [restore-drill-record.md](restore-drill-record.md)
with the measured RTO.

---

## 4. Tested Step-by-Step Restore Procedure

Follow these steps sequentially in the event of database corruption, accidental data loss, or recovery drills.

### Step 1: Pre-Incident Safety Checklist
1. **Declare Incident:** Notify the team in `#incidents` or the on-call channel.
2. **Stop Traffic / Writers:** Stop background workers to prevent partial writes while restoring:
   ```bash
   # Stop the API and processing workers
   docker compose stop backend indexer
   ```
3. **Capture a Snapshot of the Current (Damaged) State:**
   Even if corrupted, take a safety backup of the existing state before overwriting:
   ```bash
   docker exec -t audioblocks-db pg_dump -U postgres -d audioblocks -Fc > "pre_restore_safety_$(date +%Y%m%d_%H%M%S).dump"
   ```

### Step 2: Download / Locate the Target Backup File
Identify the restore candidate from local storage or S3:

```bash
# List available backups in S3
aws s3 ls "s3://${AWS_BUCKET_NAME}-backups/postgres/$(date +%Y/%m)/" --recursive

# Download selected backup
aws s3 cp "s3://${AWS_BUCKET_NAME}-backups/postgres/2026/10/18/audioblocks_backup_20261018_020000.dump" ./target_restore.dump
```

### Step 3: Terminate Active Connections
Terminate any lingering client connections to allow schema modification:

```bash
# In Docker or direct psql
docker exec -i audioblocks-db psql -U postgres -d audioblocks -c "
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE datname = 'audioblocks' AND pid <> pg_backend_pid();"
```

### Step 4: Execute the Database Restore

#### Option A: Docker Environment (Standard Local / Dev / Staging)
```bash
# Restore schema and data with clean replacement
docker exec -i audioblocks-db pg_restore \
  -U postgres \
  -d audioblocks \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --verbose < ./target_restore.dump
```

#### Option B: Production Host / Direct psql
```bash
export PGPASSWORD="${POSTGRES_PASSWORD}"

pg_restore \
  -h "${POSTGRES_HOST}" \
  -p "${POSTGRES_PORT:-5432}" \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DATABASE}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --verbose \
  ./target_restore.dump
```

> [!NOTE]
> `pg_restore` returns code 0 on success, or code 1 with non-critical warnings (e.g. `DROP ... IF EXISTS` notices for objects that didn't exist). Inspect the verbose output to confirm table data copied successfully.

---

## 5. Post-Restore Verification Checklist

Execute these verification queries immediately following the restore to confirm system integrity:

### 1. Database Connection & Schema Check
```sql
SELECT current_database(), current_user, version();
```

### 2. Verify Core Table Counts
Confirm row counts match expectations:
```sql
SELECT 'users' AS table_name, count(*) FROM users
UNION ALL
SELECT 'songs', count(*) FROM songs
UNION ALL
SELECT 'genres', count(*) FROM genres
UNION ALL
SELECT 'indexed_events', count(*) FROM indexed_events
UNION ALL
SELECT 'indexer_cursors', count(*) FROM indexer_cursors;
```

### 3. Verify Indexer Cursor State
Confirm indexer cursors exist so the on-chain event processor resumes accurately:
```sql
SELECT contract_id, network, last_processed_ledger, updated_at FROM indexer_cursors;
```

### 4. Verify TypeORM Migrations Table
Ensure the migrations log is intact:
```sql
SELECT * FROM migrations ORDER BY timestamp DESC LIMIT 5;
```

### 5. Restart Applications & Verify Health
```bash
# 1. Start the API and the non-HTTP deployables (Issue #965)
docker compose --profile full up -d

# 2. Check API readiness
curl -f http://localhost:4000/health/ready
curl -f http://localhost:4000/health/live
curl -f http://localhost:4000/health/worker

# 3. Check worker / indexer / scheduler readiness (same probe contract).
#    Docker health status aggregates these; direct checks help when diagnosing.
docker inspect --format '{{.State.Health.Status}}' \
  audioblocks-worker audioblocks-indexer audioblocks-scheduler

# 4. Check application logs for error loops
docker compose logs --tail=100 backend worker indexer scheduler
```

---

## 6. Troubleshooting Common Restore Failures

| Issue | Root Cause | Solution |
| :--- | :--- | :--- |
| `database "audioblocks" is being accessed by other users` | Open connections preventing drop/clean | Re-run Step 3 connection termination query (`pg_terminate_backend`). |
| `schema "public" already exists` | Normal notice during `--clean` restore | Informational warning; does not halt restore. |
| `role "postgres" does not exist` | Backup created with different role names | Always include `--no-owner --no-privileges` flags during `pg_restore`. |
| Outdated schema after restore | Restored backup is older than recent migration | Run `npm run migration:run` after restore to advance database to current code revision. |
| Indexer re-processing duplicate events | Cursor ledger reset to earlier state | Normal behavior: indexer event projector is idempotent via `indexed_events` deduplication. |
