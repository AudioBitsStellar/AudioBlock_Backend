import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds lastProcessedEventId to indexer_cursors so the cursor can resume
 * after the exact event it last applied, not just the ledger it was in
 * (issue #232 — "storing the last processed ledger sequence and event ID").
 */
export class AddIndexerCursorEventId1757300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'indexer_cursors',
      new TableColumn({
        name: 'lastProcessedEventId',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('indexer_cursors', 'lastProcessedEventId');
  }
}
