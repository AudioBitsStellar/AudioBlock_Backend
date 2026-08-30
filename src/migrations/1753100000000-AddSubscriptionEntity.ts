import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Migration to create the subscriptions table for managing user premium tiers.
 * Supports free, artist_pro, and label subscription tiers.
 */
export class AddSubscriptionEntity1753100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'subscriptions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'userId',
            type: 'uuid',
          },
          {
            name: 'tier',
            type: 'varchar',
            length: '50',
            default: "'free'",
          },
          {
            name: 'status',
            type: 'varchar',
            length: '50',
            default: "'active'",
          },
          {
            name: 'startDate',
            type: 'timestamp',
          },
          {
            name: 'endDate',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Add foreign key constraint
    await queryRunner.createForeignKey(
      'subscriptions',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    // Add indexes for performance
    await queryRunner.createIndex(
      'subscriptions',
      new TableIndex({
        name: 'IDX_subscriptions_userId',
        columnNames: ['userId'],
      }),
    );

    await queryRunner.createIndex(
      'subscriptions',
      new TableIndex({
        name: 'IDX_subscriptions_status',
        columnNames: ['status'],
      }),
    );

    // Add check constraint for valid tier values
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD CONSTRAINT "CHK_subscriptions_tier_valid"
      CHECK (tier IN ('free', 'artist_pro', 'label'));
    `);

    // Add check constraint for valid status values
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD CONSTRAINT "CHK_subscriptions_status_valid"
      CHECK (status IN ('active', 'cancelled', 'expired'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop constraints
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      DROP CONSTRAINT IF EXISTS "CHK_subscriptions_status_valid";
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      DROP CONSTRAINT IF EXISTS "CHK_subscriptions_tier_valid";
    `);

    // Drop indexes
    await queryRunner.dropIndex('subscriptions', 'IDX_subscriptions_status');
    await queryRunner.dropIndex('subscriptions', 'IDX_subscriptions_userId');

    // Drop foreign key (TypeORM will handle the name)
    const table = await queryRunner.getTable('subscriptions');
    const foreignKey = table?.foreignKeys.find((fk) => fk.columnNames.indexOf('userId') !== -1);
    if (foreignKey) {
      await queryRunner.dropForeignKey('subscriptions', foreignKey);
    }

    // Drop table
    await queryRunner.dropTable('subscriptions');
  }
}
