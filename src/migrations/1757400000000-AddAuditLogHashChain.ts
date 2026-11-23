import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds hash-chain columns and a purge helper index for audit-log retention (#960). */
export class AddAuditLogHashChain1757400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth_audit_logs ADD COLUMN previous_hash TEXT;
    `);
    await queryRunner.query(`
      ALTER TABLE auth_audit_logs ADD COLUMN hash TEXT;
    `);
    // Index used by the retention purge query (delete WHERE createdAt < cutoff).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_created_at
        ON auth_audit_logs (created_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_auth_audit_logs_created_at;`);
    // SQLite does not support DROP COLUMN; skip column removal on rollback.
  }
}
