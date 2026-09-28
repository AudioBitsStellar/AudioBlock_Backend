import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

/**
 * Adds the state needed for the GDPR account-deletion flow (Issue #633) and the
 * Privy identity join key (Issue #600).
 *
 * On the `users` columns:
 * - `privyUserId` is the `sub` a Privy access token carries, and the only way to
 *   map a Privy session onto a local account. Unique, so one Privy identity can
 *   never resolve to two accounts.
 * - The four deletion columns form the grace-window state machine described in
 *   `AccountDeletionRequest`: requested, schedulable, then erased.
 *
 * Partial indexes are used rather than plain ones so the erasure job's hot query
 * — "which accounts are due for deletion?" — stays cheap on a table where the
 * overwhelming majority of rows have these columns NULL.
 */
export class AddPrivyIdentityAndAccountDeletion1757100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({ name: 'privyUserId', type: 'varchar', isNullable: true }),
    );
    await queryRunner.addColumn(
      'users',
      new TableColumn({ name: 'deletionRequestedAt', type: 'timestamp', isNullable: true }),
    );
    await queryRunner.addColumn(
      'users',
      new TableColumn({ name: 'deletionScheduledFor', type: 'timestamp', isNullable: true }),
    );
    await queryRunner.addColumn(
      'users',
      new TableColumn({ name: 'deletedAt', type: 'timestamp', isNullable: true }),
    );
    await queryRunner.addColumn(
      'users',
      new TableColumn({ name: 'deletionReason', type: 'text', isNullable: true }),
    );

    // A partial unique index gives the same guarantee as a plain UNIQUE
    // constraint on a nullable column, but only for the rows that are actually
    // linked, and it stays small as the user table grows.
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_users_privyUserId" ON "users" ("privyUserId") WHERE "privyUserId" IS NOT NULL',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_users_deletionScheduledFor" ON "users" ("deletionScheduledFor") WHERE "deletedAt" IS NULL AND "deletionScheduledFor" IS NOT NULL',
    );

    await queryRunner.createTable(
      new Table({
        name: 'account_deletion_requests',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid' },
          { name: 'status', type: 'varchar', default: "'requested'" },
          { name: 'referenceId', type: 'uuid' },
          { name: 'requestedAt', type: 'timestamp' },
          { name: 'gracePeriodEndsAt', type: 'timestamp' },
          { name: 'processedAt', type: 'timestamp', isNullable: true },
          { name: 'dataExported', type: 'boolean', default: false },
          { name: 'privyDeletionStatus', type: 'varchar', isNullable: true },
          { name: 'notes', type: 'text', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'account_deletion_requests',
      new TableIndex({
        name: 'IDX_account_deletion_status',
        columnNames: ['status'],
      }),
    );
    await queryRunner.createIndex(
      'account_deletion_requests',
      new TableIndex({
        name: 'IDX_account_deletion_userId',
        columnNames: ['userId'],
      }),
    );
    await queryRunner.createIndex(
      'account_deletion_requests',
      new TableIndex({
        name: 'UQ_account_deletion_referenceId',
        columnNames: ['referenceId'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('account_deletion_requests', 'UQ_account_deletion_referenceId');
    await queryRunner.dropIndex('account_deletion_requests', 'IDX_account_deletion_userId');
    await queryRunner.dropIndex('account_deletion_requests', 'IDX_account_deletion_status');
    await queryRunner.dropTable('account_deletion_requests');

    await queryRunner.query('DROP INDEX IF EXISTS "IDX_users_deletionScheduledFor"');
    await queryRunner.query('DROP INDEX IF EXISTS "UQ_users_privyUserId"');

    await queryRunner.dropColumn('users', 'deletionReason');
    await queryRunner.dropColumn('users', 'deletedAt');
    await queryRunner.dropColumn('users', 'deletionScheduledFor');
    await queryRunner.dropColumn('users', 'deletionRequestedAt');
    await queryRunner.dropColumn('users', 'privyUserId');
  }
}
