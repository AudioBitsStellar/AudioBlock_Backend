# Restore drill record

**Result:** PASS
**Run at:** 2026-11-23T14:42:09Z
**Host:** Darwin 27.2.0 arm64
**Postgres:** 16.15
**Scripts:** `scripts/backup.sh` → `scripts/restore.sh` (the scheduled path, not a hand-written equivalent)
**Dataset:** drill-sized (3530 rows across five tables). Timings prove the
path and the checks, not production throughput — repeat against a production-sized
copy before quoting an RTO for a large database.

## Measured

| Step | Value |
| :--- | :--- |
| Backup (pg_dump + gzip + sha256 verify) | 0.24s |
| Restore (gunzip + psql) | 0.21s |
| Dump size | 100132 bytes |
| Rows compared | 3530 |
| RTO target / measured | 1800s / 0.21s (PASS) |
| RPO | ≤ 24 h — daily backup job (`database_backup`, `SCHED_DB_BACKUP_MS` / 02:00 UTC cron) |

## Fidelity

Every table matched on both row count and an ordered md5 of all row values:

| Table | Rows | Content md5 (12 chars) |
| :--- | :--- | :--- |
| `users` | 500 | `6d14a9ec8c64` |
| `songs` | 1000 | `74c3d439dc64` |
| `genres` | 25 | `76436072ee5d` |
| `indexed_events` | 2000 | `d6541f98672f` |
| `indexer_cursors` | 5 | `20b773c7358d` |

Scratch databases were dropped after the comparison; rerun with `--record` to
refresh this file and with `--keep` to inspect them.
