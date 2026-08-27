import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Creates the notifications table (Issue #79).
 *
 * Notifications are scoped to a user (deleted with the user), carry a type
 * (royalty_payout, song_status, marketplace_sale, ...) and a human-readable
 * message, and track read state. The (userId, isRead) index keeps the
 * unread-count and per-user listing queries fast.
 */
export class AddNotificationEntity1753200000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'notifications',
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
            name: 'title',
            type: 'varchar',
            length: '200',
          },
          {
            name: 'message',
            type: 'text',
          },
          {
            name: 'data',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'isRead',
            type: 'boolean',
            default: 'false',
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
      'notifications',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'notifications',
      new TableIndex({
        name: 'IDX_notifications_userId_isRead',
        columnNames: ['userId', 'isRead'],
      }),
    );

    await queryRunner.createIndex(
      'notifications',
      new TableIndex({
        name: 'IDX_notifications_createdAt',
        columnNames: ['createdAt'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('notifications', 'IDX_notifications_createdAt');
    await queryRunner.dropIndex('notifications', 'IDX_notifications_userId_isRead');

    const table = await queryRunner.getTable('notifications');
    const foreignKey = table?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('userId') !== -1,
    );
    if (foreignKey) {
      await queryRunner.dropForeignKey('notifications', foreignKey);
    }

    await queryRunner.dropTable('notifications');
  }
}
