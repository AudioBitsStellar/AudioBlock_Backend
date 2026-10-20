import { MigrationInterface, QueryRunner, Table, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Issue #824: Webhook delivery attempt tracking and failure tracking.
 * Creates webhook_deliveries table and adds consecutiveFailures column to webhook_subscriptions.
 */
export class AddWebhookDeliveriesAndFailureTracking1757700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasSubscriptionsTable = await queryRunner.hasTable('webhook_subscriptions');
    if (hasSubscriptionsTable) {
      const subscriptionsTable = await queryRunner.getTable('webhook_subscriptions');
      if (!subscriptionsTable?.findColumnByName('consecutiveFailures')) {
        await queryRunner.addColumn(
          'webhook_subscriptions',
          new TableColumn({
            name: 'consecutiveFailures',
            type: 'int',
            default: 0,
          }),
        );
      }
    }

    const hasDeliveriesTable = await queryRunner.hasTable('webhook_deliveries');
    if (!hasDeliveriesTable) {
      await queryRunner.createTable(
        new Table({
          name: 'webhook_deliveries',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              default: 'uuid_generate_v4()',
            },
            {
              name: 'subscriptionId',
              type: 'uuid',
            },
            {
              name: 'eventId',
              type: 'varchar',
              length: '255',
            },
            {
              name: 'eventType',
              type: 'varchar',
              length: '100',
            },
            {
              name: 'attempt',
              type: 'int',
              default: 1,
            },
            {
              name: 'status',
              type: 'varchar',
              length: '20',
              default: "'pending'",
            },
            {
              name: 'responseStatus',
              type: 'int',
              isNullable: true,
            },
            {
              name: 'durationMs',
              type: 'int',
              isNullable: true,
            },
            {
              name: 'error',
              type: 'text',
              isNullable: true,
            },
            {
              name: 'payload',
              type: 'text',
              isNullable: true,
            },
            {
              name: 'createdAt',
              type: 'timestamp',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
        true,
      );

      if (hasSubscriptionsTable) {
        await queryRunner.createForeignKey(
          'webhook_deliveries',
          new TableForeignKey({
            columnNames: ['subscriptionId'],
            referencedColumnNames: ['id'],
            referencedTableName: 'webhook_subscriptions',
            onDelete: 'CASCADE',
          }),
        );
      }

      await queryRunner.createIndex(
        'webhook_deliveries',
        new TableIndex({
          name: 'IDX_webhook_deliveries_subscriptionId',
          columnNames: ['subscriptionId'],
        }),
      );

      await queryRunner.createIndex(
        'webhook_deliveries',
        new TableIndex({
          name: 'IDX_webhook_deliveries_createdAt',
          columnNames: ['createdAt'],
        }),
      );

      await queryRunner.createIndex(
        'webhook_deliveries',
        new TableIndex({
          name: 'IDX_webhook_deliveries_eventId',
          columnNames: ['eventId'],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasDeliveriesTable = await queryRunner.hasTable('webhook_deliveries');
    if (hasDeliveriesTable) {
      await queryRunner.dropTable('webhook_deliveries', true);
    }

    const hasSubscriptionsTable = await queryRunner.hasTable('webhook_subscriptions');
    if (hasSubscriptionsTable) {
      const subscriptionsTable = await queryRunner.getTable('webhook_subscriptions');
      if (subscriptionsTable?.findColumnByName('consecutiveFailures')) {
        await queryRunner.dropColumn('webhook_subscriptions', 'consecutiveFailures');
      }
    }
  }
}
