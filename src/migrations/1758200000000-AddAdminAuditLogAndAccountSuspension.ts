import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

/**
 * Admin audit log and account suspension columns (#980).
 *
 * - `admin_audit_logs` records every mutating admin request. It has no foreign
 *   key to `users` so entries survive the deletion of the acting account.
 * - `users` gains the suspension state an admin sets to ban or suspend an
 *   account. A null `suspendedAt` means the account is active.
 */
export class AddAdminAuditLogAndAccountSuspension1758200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'admin_audit_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'actorId', type: 'uuid', isNullable: true },
          { name: 'method', type: 'varchar', length: '10' },
          { name: 'path', type: 'varchar', length: '500' },
          { name: 'statusCode', type: 'int' },
          { name: 'ipAddress', type: 'varchar', length: '64', isNullable: true },
          { name: 'reason', type: 'text', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'admin_audit_logs',
      new TableIndex({
        name: 'IDX_admin_audit_logs_actor_created',
        columnNames: ['actorId', 'createdAt'],
      }),
    );

    await queryRunner.createIndex(
      'admin_audit_logs',
      new TableIndex({ name: 'IDX_admin_audit_logs_created', columnNames: ['createdAt'] }),
    );

    await queryRunner.addColumns('users', [
      new TableColumn({ name: 'suspendedAt', type: 'timestamp', isNullable: true }),
      new TableColumn({ name: 'suspendedBy', type: 'uuid', isNullable: true }),
      new TableColumn({ name: 'suspensionType', type: 'varchar', length: '16', isNullable: true }),
      new TableColumn({ name: 'suspensionReason', type: 'text', isNullable: true }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('users', [
      'suspendedAt',
      'suspendedBy',
      'suspensionType',
      'suspensionReason',
    ]);
    await queryRunner.dropIndex('admin_audit_logs', 'IDX_admin_audit_logs_created');
    await queryRunner.dropIndex('admin_audit_logs', 'IDX_admin_audit_logs_actor_created');
    await queryRunner.dropTable('admin_audit_logs');
  }
}
