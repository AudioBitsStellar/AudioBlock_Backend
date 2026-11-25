/**
 * Gate for the automated backup path (Issue #968).
 *
 * The issue asks for three things a reviewer can check without a database:
 * the backup runs on a schedule, a restore drill result is recorded, and the
 * RPO/RTO numbers are stated. Everything here reads files as text — importing
 * the schedulers would boot the TypeORM data source.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');
const exists = (file: string): boolean => fs.existsSync(path.join(ROOT, file));

const workerScheduler = read('src/workers/scheduler.ts');
const cronScheduler = read('src/jobs/scheduler.ts');
const backupJob = read('src/jobs/DatabaseBackupJob.ts');
const backupScript = read('scripts/backup.sh');
const restoreScript = read('scripts/restore.sh');
const drillScript = read('scripts/restore-drill.sh');
const runbook = read('docs/runbooks/database-backup-restore.md');
const record = read('docs/runbooks/restore-drill-record.md');

describe('backup is scheduled (#968)', () => {
  it('registers database_backup in the long-running scheduler', () => {
    expect(workerScheduler).toContain("name: 'database_backup'");
    expect(workerScheduler).toContain('runDatabaseBackupJob');
    expect(workerScheduler).toContain('SCHED_DB_BACKUP_MS');
  });

  it('registers database-backup in the one-shot cron scheduler', () => {
    expect(cronScheduler).toContain("'database-backup'");
    expect(cronScheduler).toContain('runDatabaseBackupJob');
  });

  it('applies the documented retention window and verifies the dump', () => {
    expect(backupJob).toContain('BACKUP_RETENTION_DAYS');
    expect(backupJob).toContain('DEFAULT_RETENTION_DAYS = 7');
    expect(backupJob).toContain('checksum mismatch');
    expect(backupScript).toContain('checksum -c');
  });

  it('ships the scripts the runbook and package.json call', () => {
    for (const file of ['scripts/backup.sh', 'scripts/restore.sh', 'scripts/restore-drill.sh']) {
      expect(exists(file)).toBe(true);
      fs.accessSync(path.join(ROOT, file), fs.constants.X_OK);
    }
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
    expect(scripts['db:backup']).toBe('bash scripts/backup.sh');
    expect(scripts['db:restore-drill']).toBe('bash scripts/restore-drill.sh');
  });
});

describe('restore drill is recorded (#968)', () => {
  it('runs the real backup and restore scripts, not a re-implementation', () => {
    expect(drillScript).toContain('scripts/backup.sh');
    expect(drillScript).toContain('scripts/restore.sh');
    expect(drillScript).toContain('--record');
  });

  it('documents the 02:00 UTC cron entry that drives the one-shot path', () => {
    expect(runbook).toMatch(/0 2 \* \* \*/);
    expect(runbook).toContain('--job=database-backup');
  });

  it('states the RPO and RTO targets and links this drill record', () => {
    expect(runbook).toMatch(/RPO Target:\*\* < 24 hours/);
    expect(runbook).toMatch(/RTO Target:\*\* < 30 minutes/);
    expect(runbook).toContain('restore-drill-record.md');
  });

  it('records a dated, passing drill with measured timings', () => {
    expect(record).toContain('**Result:** PASS');
    expect(record).toMatch(/\*\*Run at:\*\* 20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ/);

    const restore = /\| Restore \(gunzip \+ psql\) \| ([\d.]+)s \|/.exec(record);
    const rto = /\| RTO target \/ measured \| (\d+)s \/ ([\d.]+)s \((\w+)\) \|/.exec(record);
    expect(restore).not.toBeNull();
    expect(rto).not.toBeNull();

    const measured = Number(restore![1]);
    const target = Number(rto![1]);
    expect(Number(rto![2])).toBe(measured);
    expect(rto![3]).toBe('PASS');
    expect(measured).toBeLessThanOrEqual(target);
  });

  it('states the RPO the schedule actually delivers and proves row fidelity', () => {
    expect(record).toMatch(/RPO \| ≤ 24 h/);
    expect(record).toContain('## Fidelity');
    expect(record).toMatch(/Content md5/);
  });
});
