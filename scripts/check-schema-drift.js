#!/usr/bin/env node
/**
 * Schema drift check (#926)
 *
 * After running all TypeORM migrations against a fresh Postgres database,
 * this script asks TypeORM whether `synchronize` would still want to make
 * any changes. If it would, the migrations are out of sync with the entity
 * definitions — schema drift — and the CI step exits 1 to block the merge.
 *
 * Requirements:
 *   DATABASE_URL must point to the already-migrated test database.
 *   Run after `typeorm migration:run`.
 *
 * Usage: node scripts/check-schema-drift.js
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');

const tsNode = path.join(__dirname, '..', 'node_modules', '.bin', 'ts-node');
const script = `
import AppDataSource from './src/config/db';
import { DataSource } from 'typeorm';

async function main() {
  // Create a temporary DataSource with synchronize enabled so we can get
  // the pending SQL without applying it.
  const driftSource = new DataSource({
    ...AppDataSource.options,
    synchronize: false,
    migrationsRun: false,
  } as any);
  await driftSource.initialize();

  const sqlInMemory = await driftSource.driver.createSchemaBuilder().log();
  const upQueries = sqlInMemory.upQueries;

  await driftSource.destroy();

  if (upQueries.length > 0) {
    console.error('Schema drift detected: migrations do not match entities.');
    console.error('The following DDL changes would be needed:');
    upQueries.forEach(q => console.error(' ', q.query));
    process.exit(1);
  }
  console.log('No schema drift detected — migrations match entities.');
}

main().catch(err => { console.error(err); process.exit(1); });
`;

const tmpFile = path.join(require('os').tmpdir(), 'check-schema-drift.ts');
require('fs').writeFileSync(tmpFile, script, 'utf8');

try {
  execSync(`${tsNode} --transpile-only ${tmpFile}`, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
} catch {
  process.exit(1);
}
