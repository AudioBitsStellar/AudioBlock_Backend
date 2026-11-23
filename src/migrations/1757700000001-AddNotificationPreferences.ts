import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Creates the notification_preferences table (Issue #427).
 *
 * Stores per-user opt-in/out settings for each notification type.
 * The (userId, type) pair is unique so there is exactly one row per user per
 * type; absence of a row means the type is enabled by default (opt-out model).
 *
 * The composite index mirrors the entity's @Index and the unique constraint
 * mirrors @Unique — both are needed for the preference look-up in
 * NotificationService.isTypeEnabled().
 */
export class AddNotificationPreferences1757700000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'notification_preferences',
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
            name: 'type',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'enabled',
            type: 'boolean',
            default: true,
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

    await queryRunner.createForeignKey(
      'notification_preferences',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createUniqueConstraint(
      'notification_preferences',
      new TableUnique({
        name: 'UQ_notification_preferences_userId_type',
        columnNames: ['userId', 'type'],
      }),
    );

    await queryRunner.createIndex(
      'notification_preferences',
      new TableIndex({
        name: 'IDX_notification_preferences_userId_type',
        columnNames: ['userId', 'type'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'notification_preferences',
      'IDX_notification_preferences_userId_type',
    );

    await queryRunner.dropUniqueConstraint(
      'notification_preferences',
      'UQ_notification_preferences_userId_type',
    );

    const table = await queryRunner.getTable('notification_preferences');
    const foreignKey = table?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('userId') !== -1,
    );
    if (foreignKey) {
      await queryRunner.dropForeignKey('notification_preferences', foreignKey);
    }

    await queryRunner.dropTable('notification_preferences');
  }
}
