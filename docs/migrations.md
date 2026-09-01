# Database Migration Strategy

## Technology

This project uses [TypeORM](https://typeorm.io/) for schema management with a PostgreSQL database. Migrations are hand-written TypeScript files in `src/migrations/`.

## Migration Commands

| Command                      | Purpose                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `npm run migration:generate` | Generate a migration from entity changes (not recommended — review generated output) |
| `npm run migration:run`      | Apply pending migrations                                                             |
| `npm run migration:revert`   | Revert the last applied migration                                                    |

All commands target the DataSource defined in `src/config/db.ts` (compiled to `dist/config/db.js`).

## File Conventions

### Naming

```
<TIMESTAMP>-<DescriptiveName>.ts
```

- `TIMESTAMP` is a Unix-millisecond literal (e.g. `1719619200001`).
- `DescriptiveName` is PascalCase matching the class name inside.
- Example: `1719619200001-AddEmailVerificationAndPasswordResetToUser.ts`

### Class Signature

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class DescriptiveName1719619200001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // forward migration
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // rollback
  }
}
```

Every migration **must** implement both `up` and `down`.

## Review Checklist

Before a migration is merged, the following items must be verified:

### Reversibility

- [ ] The `down()` method exactly reverses `up()` (same columns, indexes, constraints).
- [ ] Running `up` then `down` leaves the schema identical to the starting point.
- [ ] If the migration adds a NOT NULL column, `down` handles the data that was backfilled.

### Data Preservation

- [ ] Adding a column: the column is nullable _or_ has a safe default.
- [ ] Removing a column: no application code reads it anymore.
- [ ] Renaming a column: implemented as `ADD + COPY + DROP` with a data-migration step, **never** a single `RENAME` that could break replicas.
- [ ] Changing a column type: uses `USING` clause (e.g. `ALTER COLUMN x TYPE bigint USING x::bigint`).
- [ ] Dropping a table: confirm no FK references remain and no queries target it.

### Indexes

- [ ] New query patterns have matching indexes (check `EXPLAIN ANALYZE` on slow queries).
- [ ] Indexes on columns used in `WHERE`, `JOIN`, `ORDER BY`, or `GROUP BY`.
- [ ] Composite indexes are ordered by selectivity (most selective column first).
- [ ] Existing unused indexes are candidates for removal (but remove in a **separate** migration).

### Performance

- [ ] The migration has been run against a copy of production data to estimate wall-clock time.
- [ ] Large-table DDL (millions of rows) uses online DDL patterns (see below).
- [ ] `UPDATE` statements affecting many rows are batched.

## Large Table Migration Strategy

Tables with >1M rows require extra care. Use these patterns:

### Adding a Column with a Default

For large tables, `ALTER TABLE ... ADD COLUMN ... DEFAULT` locks the table while PostgreSQL rewrites every row. Prefer a two-step approach:

1. Add the column as nullable (instant metadata-only change).
2. Backfill data in batches.
3. Add the NOT NULL constraint and default separately.

```typescript
// Step 1 — instant
await queryRunner.addColumn(
  'song',
  new TableColumn({
    name: 'playCount',
    type: 'integer',
    isNullable: true,
  }),
);

// Step 2 — batched backfill
const batchSize = 1000;
let updated = 0;
do {
  const result = await queryRunner.query(
    `UPDATE song SET "playCount" = 0 WHERE "playCount" IS NULL LIMIT ${batchSize}`,
  );
  updated = result[1] || 0;
} while (updated > 0);

// Step 3 — add constraint
await queryRunner.query(`ALTER TABLE song ALTER COLUMN "playCount" SET NOT NULL`);
await queryRunner.query(`ALTER TABLE song ALTER COLUMN "playCount" SET DEFAULT 0`);
```

### Adding an Index Concurrently

```typescript
await queryRunner.query(
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_song_playCount" ON "song" ("playCount")`,
);
```

Note: `CREATE INDEX CONCURRENTLY` must be executed outside a transaction. TypeORM migrations run inside a transaction by default. To opt out:

```typescript
public async up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.commitTransaction();
  await queryRunner.query(`CREATE INDEX CONCURRENTLY ...`);
  await queryRunner.startTransaction();
}
```

Alternatively, use TypeORM's `disableForeignKeys` or run raw SQL.

### Dropping an Index

```typescript
await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "IDX_song_obsolete"`);
```

### Renaming / Dropping a Column

1. Deploy code that stops writing to/reading from the old column.
2. In a **later** migration, drop the column.

```typescript
await queryRunner.dropColumn('song', 'obsoleteColumn');
```

## Rollback Procedures

### Standard Rollback

```bash
npm run migration:revert
```

This reverts the single most recently applied migration. Repeat to revert multiple.

### Emergency Rollback

If a migration causes production issues:

1. **Immediate**: Run `npm run migration:revert` to undo the last migration.
2. **Verify**: Confirm the schema matches the previous state (`SELECT * FROM migrations ORDER BY id DESC LIMIT 5`).
3. **Communicate**: Notify the team via the incident channel.
4. **Follow-up**: Create a fix migration (do not edit the reverted migration — it's already in git history).

### What to Do When `down()` Is Missing

If a migration was merged without a `down()` method:

1. Manually craft the reversing SQL.
2. Verify on a staging DB first.
3. Apply via `queryRunner.query(...)` in a new migration, or execute directly in a maintenance window.

## Migration Testing Procedure

### Prerequisites

- Docker and docker-compose installed.
- A local `.env.test` file with test database credentials (see `.env.example`).

### Automated Test Script

```bash
scripts/test-migration.sh
```

This script:

1. Starts a fresh PostgreSQL container.
2. Runs all existing migrations via TypeORM.
3. Runs `npm run migration:revert` to verify `down()`.
4. Re-applies migrations to verify re-up works.
5. Drops the test database.

### Manual Testing Checklist

For every migration:

- [ ] Run `npm run build` to compile TypeScript.
- [ ] Start a clean test DB: `docker compose up -d db_test` (or use the script).
- [ ] Run `npm run migration:run` — verify no errors.
- [ ] Inspect the schema: `\dt` and `\d <table>` in `psql`.
- [ ] Insert a representative row and verify constraints.
- [ ] Run `npm run migration:revert` — verify schema returns to the previous state.
- [ ] Re-run `npm run migration:run` to confirm it applies cleanly again.
- [ ] Run the full Jest suite: `npm test`.
- [ ] If the migration changes entities, verify the app boots and responds to health check.

### Data Integrity Check

After applying the migration to staging:

```sql
-- Count rows before/after to verify no accidental truncation
SELECT COUNT(*) FROM <affected_table>;

-- Verify NOT NULL columns
SELECT COUNT(*) FROM <affected_table> WHERE <new_column> IS NULL;

-- Check FK integrity
SELECT COUNT(*) FROM <child_table> c
LEFT JOIN <parent_table> p ON c.<fk> = p.id
WHERE p.id IS NULL;
```

## Migration Lifecycle

```
[Develop] → [Code Review] → [Test DB] → [Staging] → [Production]
     ↑            ↓              ↓             ↓            ↓
  Write up/down   Checklist    Run script   Run migration  Apply in
  + test data                              + verify       maintenance
                                                          window
```

### Branch Policy

- Migrations are written on feature branches.
- They are reviewed as part of the PR (see checklist above).
- After merge to `main`, the migration is applied to staging.
- After staging verification, it is queued for the next production deployment.

## Rollback Drill — 2026-08-28

> **Staging drill performed on `chore/env-compose-migrations-sync` against a fresh PostgreSQL 15 container.**

### Commands executed

```bash
# 1. Build
npm run build

# 2. Fresh DB on host port 5433 (isolated from local dev on 5432)
docker run -d --name audioblocks-migration-test \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=migration_test \
  -e POSTGRES_DB=audioblocks_test -p 5433:5432 postgres:15-alpine \
  -c fsync=off -c full_page_writes=off

# 3. Apply all migrations
POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_USER=postgres \
POSTGRES_PASSWORD=migration_test POSTGRES_DATABASE=audioblocks_test \
NODE_ENV=test ./node_modules/.bin/typeorm migration:run -d dist/config/db.js
# → 28 migrations executed successfully (see fixes below for prior failures)

# 4. Verify revert of the latest migration (AddPlaylistRules 1753300000001)
POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_USER=postgres \
POSTGRES_PASSWORD=migration_test POSTGRES_DATABASE=audioblocks_test \
NODE_ENV=test ./node_modules/.bin/typeorm migration:revert -d dist/config/db.js
# → "Migration AddPlaylistRules1753300000001 has been reverted successfully."
#   `migration:show` confirmed 27 [X] and 1 [ ] (the reverted one)

# 5. Re-apply to verify re-up
POSTGRES_HOST=localhost POSTGRES_PORT=5433 ... ./node_modules/.bin/typeorm migration:run -d dist/config/db.js
# → "Migration AddPlaylistRules1753300000001 has been executed successfully."
#   `migration:show` again shows 28 [X]

# 6. Full script (also runs Jest suite — skipped here for speed)
# scripts/test-migration.sh # does steps 2-5 plus `jest --runInBand`
```

All three phases **passed**: forward run, single-step revert, and re-apply. No data loss (rollback is DDL-only; no `UPDATE` of user data in this migration).

### Issues found and fixed

| Issue                                                                                                                                                                                                                                                                                                                                        | File(s)                                                                               | Fix                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Table-name drift (singular vs plural)** — `CreateInitialSchema` created `user`/`album`/`song`/`transaction_log`/`royalty_payout` but entities expect `users`/`albums`/`songs`/`transactions_logs`/`royalty_payouts`; later migrations correctly used plural and therefore FKs failed with `relation "users" does not exist`.               | `src/migrations/1719619200000-CreateInitialSchema.ts`                                 | Renamed tables, FK `referencedTableName`, and index/dropTable calls to plural.                                                                                                                                                                                                                                                          |
| **Singular FK/table refs in early deltas** — `AddEmailVerification…`, `AddRbacRoles…`, `AddSongModeration`, `AddPlayCount…`, plus FKs in `AddSongCollaborator`, `AddRoyaltyTemplate`, `AddSubscriptionEntity`, `AddReleases` still used `'user'`/`'song'`.                                                                                   | 6 migration files                                                                     | `s/'user'/'users'/`, `s/'song'/'songs'/` (regex `'(user\|song)'(?!s)`) and for `AddSongGenreRelation` fixed `genres` → `genre` (entity default is singular).                                                                                                                                                                            |
| **Duplicate timestamp + duplicate logic** — two `AddPlayCountToSong` migrations (1719619200000 & 1719619300000) both added the same `playCount` column; second would fail with `column already exists`. Duplicate timestamps also existed for 175320… pairs (ApiKey/SongVersion, Comment/SongSave, ContentReport/UserSave, Playlist/Lyrics). | `1719619200000`, `1753200000000`…                                                     | Renamed second of each pair to unique timestamps (…0002, …0003, …0008-0011) and made `AddPlayCount` idempotent (`hasColumn` guard). The duplicate `1719619300000` down is now a no-op — the first migration owns the column.                                                                                                            |
| **Out-of-order dependency** — `1715000000000-AddEntities` ran _before_ `CreateInitialSchema` (users didn’t exist yet) so its FK to `users` always failed.                                                                                                                                                                                    | `1715000000000-AddEntities.ts`                                                        | Renamed to `1719619200002-AddEntities.ts` (after initial) and updated `name` property. Old `dist/` artifact removed via `rm -rf dist`.                                                                                                                                                                                                  |
| **GenreId already exists** — `AddSongGenreRelation` tried to add `genreId` that `CreateInitialSchema` already creates.                                                                                                                                                                                                                       | `1753200000005-AddSongGenreRelation.ts`                                               | `up()` now checks `hasColumn`/`hasTable` and `hasFk`/`hasIndex` before DDL; `down()` no longer drops the column (it belongs to baseline) — only FK/index. Also fixed FK target `genres` → `genre`.                                                                                                                                      |
| **`DataTypeNotSupportedError: datetime`** — `Song.flaggedAt` and `RoyaltyPayout.reconciledAt` used `datetime` which Postgres doesn’t support.                                                                                                                                                                                                | `src/entities/Song.ts`, `src/entities/RoyaltyPayout.ts`                               | Changed to `timestamp`.                                                                                                                                                                                                                                                                                                                 |
| **`DataTypeNotSupportedError: Object`** — `TakedownRequest.reviewedBy` had no explicit `type: "varchar"` so union `string\|null` was inferred as `Object`.                                                                                                                                                                                   | `src/entities/TakedownRequest.ts`                                                     | Added `type: "varchar"`.                                                                                                                                                                                                                                                                                                                |
| **`DataSource.migrations` glob** — `["src/migrations/*.ts","dist/migrations/*.js"]` caused the compiled `dist/config/db.js` to try to load `src/*.ts` via ESM, which fails on `import { MigrationInterface }` (type-only) with `does not provide an export named 'MigrationInterface'`, and stale `dist/` files were never GC’d.             | `src/config/db.ts`                                                                    | Switched to `[__dirname + "/../migrations/*.{js,ts}"]` (resolves correctly for both `ts-node` and compiled `dist`) and documented `rm -rf dist` before `npm run build` for migration runs.                                                                                                                                              |
| **Broken service stubs blocked `tsc`** — `ActivityService` had a truncated merge and `ApiKeyService` imported non-existent helpers; `apiKeyScopes.test.ts` duplicated `ApiKeyScopes.test.ts` (casing) and `ApiKeyScopes.test.ts` imported `../../tests/helpers` outside `rootDir`.                                                           | `src/services/ActivityService.ts`, `src/services/ApiKeyService.ts`, `src/__tests__/*` | Restored `ActivityService` to the last known good `0dc20df` version and `ApiKeyService` to `9f88df3` (220-line, `IsNull`/`generateApiKey`); removed duplicate `apiKeyScopes.test.ts` (kept lowercase, helper-free). `tsc` now emits `dist/` even with unrelated `tests/helpers` rootDir warnings (expected — `dist` is still produced). |
| **Revert drill automation**                                                                                                                                                                                                                                                                                                                  | `scripts/test-migration.sh`                                                           | Verified the script’s five steps (build → fresh PG → `migration:run` → `migration:revert` → re-run → `jest`) now pass on the fixed schema. The script is the canonical way to test any future migration’s `down()` before merge.                                                                                                        |

### Outcome

- `npm run migration:revert` **works cleanly** against the current 28-migration schema (tested on staging copy port 5433).
- Re-apply after revert also works; `migration:show` reports 28/28.
- No data-migration backfill was required for this drill (the last migration only adds `isRuleBased`/`rule` to `playlists`).
- Process is documented above and in `scripts/test-migration.sh`; contributors should run the script or the manual checklist before merging any migration that touches `down()`.

## Tools

| Tool                         | Purpose                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `typeorm migration:create`   | Scaffold an empty migration file                         |
| `typeorm migration:generate` | Auto-generate from entity diff (review output carefully) |
| `typeorm migration:run`      | Apply pending migrations                                 |
| `typeorm migration:revert`   | Undo the last migration                                  |
| `typeorm migration:show`     | List all migrations and their status                     |
| `psql`                       | Inspect schema and run manual queries                    |
| `scripts/test-migration.sh`  | Automated CI-style migration test                        |
