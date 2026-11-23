import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';

jest.mock('child_process', () => ({ execFile: jest.fn() }));
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  DEFAULT_RETENTION_DAYS,
  resolveRetentionDays,
  runDatabaseBackupJob,
} from '../DatabaseBackupJob';

type ExecCallback = (
  err: (Error & { stderr?: string }) | null,
  result?: { stdout: string; stderr: string },
) => void;

const execFileMock = execFile as unknown as jest.Mock;
const DUMP_NAME = 'backup_20260101_000000.sql.gz';

let backupDir: string;

beforeEach(() => {
  execFileMock.mockReset();
  backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-backup-test-'));
});

afterEach(() => {
  fs.rmSync(backupDir, { recursive: true, force: true });
});

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Stand-in for scripts/backup.sh: writes a dump plus sidecar, reports the path. */
function mockBackupScript(
  options: {
    content?: string;
    sidecarContent?: string | null;
    reportFile?: boolean;
    failure?: { stderr: string };
  } = {},
): void {
  const { content = 'fake-pg-dump', sidecarContent, reportFile = true, failure } = options;

  execFileMock.mockImplementation(
    (_file: string, _args: string[], opts: { env: NodeJS.ProcessEnv }, callback: ExecCallback) => {
      if (failure) {
        callback(Object.assign(new Error('Command failed'), failure));
        return;
      }

      const dir = opts.env.BACKUP_DIR as string;
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, DUMP_NAME);
      fs.writeFileSync(file, content);
      if (sidecarContent !== null) {
        fs.writeFileSync(`${file}.sha256`, sidecarContent ?? `${sha256(content)}  ${file}\n`);
      }

      const stdout = reportFile
        ? `Creating backup ${file}...\nBACKUP_FILE=${file}\nBackup created successfully\n`
        : 'Creating backup...\nBackup created successfully\n';
      callback(null, { stdout, stderr: '' });
    },
  );
}

describe('runDatabaseBackupJob (#968)', () => {
  it('returns the verified dump and its size/checksum', async () => {
    mockBackupScript({ content: 'fake-pg-dump' });

    const result = await runDatabaseBackupJob({ backupDir, retentionDays: 7 });

    expect(result.file).toBe(path.join(backupDir, DUMP_NAME));
    expect(result.bytes).toBe(Buffer.byteLength('fake-pg-dump'));
    expect(result.sha256).toBe(sha256('fake-pg-dump'));
    expect(result.pruned).toEqual([]);
    expect(fs.existsSync(result.file)).toBe(true);
  });

  it('points the script at the configured backup directory', async () => {
    mockBackupScript();
    await runDatabaseBackupJob({ backupDir });
    expect(execFileMock.mock.calls[0][2].env.BACKUP_DIR).toBe(backupDir);
  });

  it('refuses to guess which dump to verify when the script does not report one', async () => {
    mockBackupScript({ reportFile: false });
    await expect(runDatabaseBackupJob({ backupDir })).rejects.toThrow(/refusing to guess/);
  });

  it('rejects a dump that has no checksum sidecar', async () => {
    mockBackupScript({ sidecarContent: null });
    await expect(runDatabaseBackupJob({ backupDir })).rejects.toThrow(/no sha256 sidecar/);
  });

  it('rejects a dump whose content does not match its sidecar', async () => {
    mockBackupScript({ content: 'truncated', sidecarContent: `${sha256('full')}  x\n` });
    await expect(runDatabaseBackupJob({ backupDir })).rejects.toThrow(/checksum mismatch/);
  });

  it('surfaces the script failure with its stderr', async () => {
    mockBackupScript({ failure: { stderr: 'pg_dump: error: connection refused' } });
    await expect(runDatabaseBackupJob({ backupDir })).rejects.toThrow(/connection refused/);
  });

  it('prunes expired dumps and sidecars but keeps fresh and unrelated files', async () => {
    mockBackupScript({ content: 'fresh' });

    const oldDump = path.join(backupDir, 'backup_20250101_000000.sql.gz');
    const oldSidecar = `${oldDump}.sha256`;
    const freshDump = path.join(backupDir, 'backup_20260102_000000.sql.gz');
    const unrelated = path.join(backupDir, 'backup_manual.sql.gz');
    for (const file of [oldDump, oldSidecar, freshDump, unrelated]) {
      fs.writeFileSync(file, 'x');
    }
    // With `now` = 2026-01-02 and a 7-day window the cutoff is 2025-12-26, so
    // 2025-12-20 is expired (and 2025-12-30 would not be).
    const expiredAt = new Date('2025-12-20T00:00:00Z');
    for (const file of [oldDump, oldSidecar, unrelated]) fs.utimesSync(file, expiredAt, expiredAt);

    const result = await runDatabaseBackupJob({
      backupDir,
      retentionDays: 7,
      now: new Date('2026-01-02T00:00:00Z'),
    });

    expect(result.pruned).toEqual(['backup_20250101_000000.sql.gz']);
    expect(fs.existsSync(oldDump)).toBe(false);
    expect(fs.existsSync(oldSidecar)).toBe(false);
    expect(fs.existsSync(freshDump)).toBe(true);
    expect(fs.existsSync(unrelated)).toBe(true);
    expect(fs.existsSync(result.file)).toBe(true);
  });
});

describe('resolveRetentionDays', () => {
  it('defaults to 7 days', () => {
    expect(resolveRetentionDays(undefined)).toBe(DEFAULT_RETENTION_DAYS);
  });

  it.each(['0', '-3', 'abc', ''])('falls back for the invalid value %p', (raw) => {
    expect(resolveRetentionDays(raw)).toBe(DEFAULT_RETENTION_DAYS);
  });

  it('honours a positive integer', () => {
    expect(resolveRetentionDays('30')).toBe(30);
  });
});
