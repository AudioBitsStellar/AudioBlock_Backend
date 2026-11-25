/**
 * Automated database backup job (OPS-08 / Issue #968).
 *
 * Wraps scripts/backup.sh — the same script the runbook tells an on-call
 * engineer to run by hand — so the scheduled path and the manual path cannot
 * drift apart. On top of the script this job:
 *
 *   - fails on a missing or mismatched sha256 sidecar (a truncated dump is a
 *     broken backup, not a smaller one);
 *   - applies the retention window from the runbook (BACKUP_RETENTION_DAYS,
 *     default 7) by deleting expired dumps *and* their sidecars;
 *   - returns a structured result so the scheduler log records what was
 *     written and what was pruned.
 *
 * Intended callers: src/workers/scheduler.ts (daily interval) and
 * src/jobs/scheduler.ts --job=database-backup (Kubernetes CronJob / cron).
 */
import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import logger from '../config/logger';

const execFileAsync = promisify(execFile);

/** Repository root — scripts/ lives here, both from src/ and from dist/. */
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BACKUP_SCRIPT = path.join(REPO_ROOT, 'scripts', 'backup.sh');

export const DEFAULT_RETENTION_DAYS = 7;
const BACKUP_NAME_PATTERN = /^backup_\d{8}_\d{6}\.sql\.gz$/;

export interface DatabaseBackupOptions {
  /** Directory the script writes into (default: BACKUP_DIR or ./backups). */
  backupDir?: string;
  /** Days to keep dumps (default: BACKUP_RETENTION_DAYS or 7). */
  retentionDays?: number;
  /** Clock injection point, for tests. */
  now?: Date;
}

export interface DatabaseBackupResult {
  file: string;
  bytes: number;
  sha256: string;
  pruned: string[];
}

function envValue(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

export function resolveRetentionDays(raw = process.env.BACKUP_RETENTION_DAYS): number {
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_RETENTION_DAYS;
}

/** sha256 of a file, as the hex digest backup.sh writes into the sidecar. */
function sha256OfFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function parseCreatedFile(stdout: string): string {
  const match = /^BACKUP_FILE=(.+)$/m.exec(stdout);
  if (!match) {
    throw new Error('backup.sh did not report BACKUP_FILE; refusing to guess which dump to verify');
  }
  return match[1].trim();
}

/**
 * Delete dumps (and their sidecars) older than the retention window.
 * Only files matching the script's own naming pattern are touched.
 */
function pruneExpired(backupDir: string, retentionDays: number, now: Date): string[] {
  if (!fs.existsSync(backupDir)) return [];
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const pruned: string[] = [];

  for (const entry of fs.readdirSync(backupDir)) {
    if (!BACKUP_NAME_PATTERN.test(entry)) continue;
    const full = path.join(backupDir, entry);
    const stats = fs.statSync(full);
    if (stats.mtimeMs >= cutoff) continue;

    fs.unlinkSync(full);
    const sidecar = `${full}.sha256`;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    pruned.push(entry);
  }

  return pruned.sort();
}

/** Map the app's POSTGRES_* settings onto the script's DB_* contract. */
function backupEnv(backupDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BACKUP_DIR: backupDir,
    DB_USER: envValue('DB_USER') ?? envValue('POSTGRES_USER') ?? 'postgres',
    DB_HOST: envValue('DB_HOST') ?? envValue('POSTGRES_HOST') ?? 'localhost',
    DB_PORT: envValue('DB_PORT') ?? envValue('POSTGRES_PORT') ?? '5432',
    DB_NAME: envValue('DB_NAME') ?? envValue('POSTGRES_DATABASE') ?? 'audioblocks',
  };
}

async function runBackupScript(env: NodeJS.ProcessEnv): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('bash', [BACKUP_SCRIPT], { cwd: REPO_ROOT, env }));
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    logger.error({ err, stderr }, 'Database backup failed');
    throw new Error(
      `Database backup failed${stderr ? `: ${stderr.split('\n').slice(-3).join(' | ')}` : ''}`,
    );
  }
  return parseCreatedFile(stdout);
}

/** Re-read the dump and prove it matches the sidecar the script wrote. */
async function verifyBackup(file: string): Promise<string> {
  if (!fs.existsSync(file)) {
    throw new Error(`backup.sh reported ${file} but the file does not exist`);
  }
  const sidecar = `${file}.sha256`;
  if (!fs.existsSync(sidecar)) {
    throw new Error(`Backup ${path.basename(file)} has no sha256 sidecar`);
  }

  const expected = fs.readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0].toLowerCase();
  const actual = await sha256OfFile(file);
  if (expected !== actual) {
    throw new Error(
      `Backup checksum mismatch for ${path.basename(file)} (sidecar ${expected}, file ${actual})`,
    );
  }
  return actual;
}

export async function runDatabaseBackupJob(
  options: DatabaseBackupOptions = {},
): Promise<DatabaseBackupResult> {
  const retentionDays = options.retentionDays ?? resolveRetentionDays();
  const backupDir = path.resolve(
    REPO_ROOT,
    options.backupDir ?? envValue('BACKUP_DIR') ?? 'backups',
  );

  const file = path.resolve(REPO_ROOT, await runBackupScript(backupEnv(backupDir)));
  const sha256 = await verifyBackup(file);
  const pruned = pruneExpired(backupDir, retentionDays, options.now ?? new Date());
  const bytes = fs.statSync(file).size;

  logger.info({ file, bytes, retentionDays, pruned }, 'Database backup completed and verified');
  return { file, bytes, sha256, pruned };
}

if (require.main === module) {
  runDatabaseBackupJob()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'Database backup job failed');
      process.exit(1);
    });
}
