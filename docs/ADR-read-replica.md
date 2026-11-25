# ADR: Read-Replica Readiness (PERF-09)

**Status:** Accepted  
**Issue:** #950  
**Date:** 2026-11-22

## Context

AudioBlock's PostgreSQL instance currently handles all read and write traffic on a single primary node. As song play events, search queries, and analytics dashboard loads grow, read-heavy workloads compete with write-heavy workloads (uploads, mints, royalty payouts) for the same connection pool, increasing p95 latency and risking pool exhaustion (`db_pool_exhausted` metric, Issue #334).

## Decision

Introduce a read replica using PostgreSQL streaming replication, and route read-only queries (song catalogue search, play-count lookups, analytics aggregations, user profile reads) to the replica while writes (uploads, mints, payouts, auth mutations) continue to target the primary.

## Read/Write split design

| Query category | Target | Examples |
|---|---|---|
| Writes | Primary | `INSERT/UPDATE/DELETE` on `songs`, `mints`, `payouts`, `users` |
| Transactional reads | Primary | Reads inside a write transaction (e.g. post-insert fetch) |
| Catalogue reads | Replica | `SELECT` on `songs`, `genres`, `artists` for search/browse |
| Play-count reads | Replica | Leaderboard and popularity queries |
| Analytics reads | Replica | Dashboard aggregations, royalty history |
| Auth reads | Primary | Session lookups, permission checks (consistency required) |

### Implementation steps

1. **Provision replica** — Enable streaming replication on the managed PostgreSQL instance (AWS RDS read replica or equivalent). Set `max_standby_streaming_delay = 30s` and `hot_standby_feedback = on`.

2. **Connection routing** — Introduce a `ReplicaDataSource` alongside the existing `DataSource` in `src/config/`. TypeORM supports multiple data sources; inject `ReadDataSource` into services that perform only `SELECT` queries.

3. **Service layer changes** — Annotate read-only service methods with the replica connection. Write methods remain on the primary. Services in scope: `SongService.search`, `SongService.getById`, `PlayService.getCount`, `RoyaltyService.getHistory`, `UserService.getProfile`.

4. **Replication lag guard** — Add a `db_replica_lag_seconds` Prometheus gauge (polled from `pg_stat_replication` via a cron job). Alert if lag > 30 s. If lag exceeds 60 s, fall back all reads to the primary until lag recovers.

5. **Connection pool sizing** — Size the replica pool independently (`DB_REPLICA_POOL_MAX`, default 10). The primary pool (`DB_POOL_MAX`, currently 10) stays unchanged.

6. **Testing** — Integration tests run against the primary only (replica is not provisioned in CI). Service-layer unit tests mock both data sources.

### Environment variables

| Variable | Description |
|---|---|
| `DB_REPLICA_HOST` | Hostname of the read replica |
| `DB_REPLICA_PORT` | Port (default 5432) |
| `DB_REPLICA_USER` | Replica DB user (read-only role recommended) |
| `DB_REPLICA_PASSWORD` | Replica DB password |
| `DB_REPLICA_NAME` | Database name (same as primary) |
| `DB_REPLICA_POOL_MAX` | Max replica pool connections (default 10) |
| `DB_REPLICA_LAG_ALERT_SECONDS` | Lag threshold for Prometheus alert (default 30) |

## Consequences

**Positive:**
- Removes read contention from the primary, reducing p95 latency for write-heavy bursts.
- Scales read capacity horizontally without touching the write path.
- `db_pool_exhausted` gauge will reflect primary load only, reducing false-positive alerts.

**Negative:**
- Read replicas have replication lag (typically < 1 s for streaming, up to 30 s under heavy write load). Stale reads are acceptable for catalogue browsing and analytics but not for auth or post-write confirmations — those must stay on the primary.
- Operational complexity: two connection pools to monitor, replica failover strategy needed.
- If `DB_REPLICA_HOST` is not set, the application falls back gracefully to the primary for all queries (safe default for local development and CI).

## Alternatives considered

- **PgBouncer connection pooling only:** Reduces connection overhead but does not reduce read load on the primary. Rejected as insufficient for the target scale.
- **Caching layer (Redis):** Complements but does not replace the replica; cache invalidation on uploads/mints adds complexity. Deferred to a follow-up issue.
- **Horizontal sharding:** Over-engineered for current scale. Revisit if write throughput exceeds primary capacity.
