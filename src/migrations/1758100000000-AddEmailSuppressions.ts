import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/**
 * Suppression list for transactional email (issue PROD-03).
 *
 * `email_suppressions` holds addresses that hard-bounced, were reported as spam,
 * or were dropped by the provider. The `email.send` job skips these addresses so
 * a bad address cannot keep hurting sender reputation.
 */
export class AddEmailSuppressions1758100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'email_suppressions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'email', type: 'varchar', length: '320' },
          { name: 'reason', type: 'varchar', length: '32' },
          { name: 'source', type: 'varchar', length: '32' },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
        uniques: [{ name: 'UQ_email_suppressions_email', columnNames: ['email'] }],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('email_suppressions');
  }
}
