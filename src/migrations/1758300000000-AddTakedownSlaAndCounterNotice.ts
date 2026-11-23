import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

/**
 * Review deadlines and artist counter-notices for takedown requests (#981).
 *
 * Existing rows are backfilled so historical requests get the same deadlines a
 * new request would: pending requests are due three days after they were filed,
 * and approved requests allow a counter-notice for fourteen days after approval.
 */
export class AddTakedownSlaAndCounterNotice1758300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('takedown_requests', [
      new TableColumn({ name: 'reviewDueAt', type: 'timestamp', isNullable: true }),
      new TableColumn({ name: 'counterNoticeDueAt', type: 'timestamp', isNullable: true }),
      new TableColumn({ name: 'counterNotice', type: 'text', isNullable: true }),
      new TableColumn({ name: 'counterNoticeAt', type: 'timestamp', isNullable: true }),
      new TableColumn({ name: 'counterNoticeBy', type: 'varchar', isNullable: true }),
    ]);

    await queryRunner.createIndex(
      'takedown_requests',
      new TableIndex({
        name: 'IDX_takedown_requests_status_review_due',
        columnNames: ['status', 'reviewDueAt'],
      }),
    );

    await queryRunner.query(`
      UPDATE "takedown_requests"
      SET "reviewDueAt" = "createdAt" + INTERVAL '3 days'
      WHERE "status" = 'pending' AND "reviewDueAt" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "takedown_requests"
      SET "counterNoticeDueAt" = "resolvedAt" + INTERVAL '14 days'
      WHERE "status" = 'approved' AND "counterNoticeDueAt" IS NULL AND "resolvedAt" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('takedown_requests', 'IDX_takedown_requests_status_review_due');
    await queryRunner.dropColumns('takedown_requests', [
      'counterNoticeBy',
      'counterNoticeAt',
      'counterNotice',
      'counterNoticeDueAt',
      'reviewDueAt',
    ]);
  }
}
