import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthAuditLog1757300000000 implements MigrationInterface {
  name = 'AddAuthAuditLog1757300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "auth_audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid,
        "eventType" character varying NOT NULL,
        "ipAddress" character varying,
        "userAgent" character varying,
        "email" character v
reatedAt" ON "auth_audit_logs" ("eventType", "createdAt")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_auth_audit_logs_ipAddress_createdAt" ON "auth_audit_logs" ("ipAddress", "createdAt")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_auth_audit_logs_userId" ON "auth_audit_logs" ("userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_auth_audit_logs_userId"`);
    await queryRunner.query(`DROP INDEX "IDX_auth_audit_logs_ipAddress_createdAt"`);
    await queryRunner.query(`DROP INDEX "IDX_auth_audit_logs_eventType_createdAt"`);
    await queryRunner.query(`DROP INDEX "IDX_auth_audit_logs_userId_createdAt"`);
    await queryRunner.query(`DROP TABLE "auth_audit_logs"`);
  }
}
