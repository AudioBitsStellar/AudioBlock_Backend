import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Adds indexer_cursors and backfill_status tables for blockchain event indexing.
 * Issues #241, #250, #253.
 */
export class AddIndexerEntities1756684800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create indexer_cursors table
    await queryRunner.createTable(
      new Table({
        name: 'indexer_cursors',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'contractId',
            type: 'varchar',
            length: '100',
          },
          {
            name: 'network',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'lastProcessedLedger',
            type: 'bigint',
            default: 0,
          },
          {
            name: 'eventsProcessed',
            type: 'bigint',
            default: 0,
          },
          {
            name: 'errorCount',
            type: 'bigint',
            default: 0,
          },
          {
            name: 'lastError',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'lastErrorAt',
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

    // Add unique constraint on contractId + network
    await queryRunner.createIndex(
      'indexer_cursors',
      new TableIndex({
        name: 'IDX_indexer_cursors_contract_network',
        columnNames: ['contractId', 'network'],
        isUnique: true,
      }),
    );

    // Create backfill_status table
    await queryRunner.createTable(
      new Table({
        name: 'backfill_status',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'contractId',
            type: 'varchar',
            length: '100',
          },
          {
            name: 'network',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'completed',
            type: 'boolean',
            default: false,
          },
          {
            name: 'startLedger',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'endLedger',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'eventsImported',
            type: 'bigint',
            default: 0,
          },
          {
            name: 'errorMessage',
            type: 'text',
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

    // Add unique constraint on contractId + network
    await queryRunner.createIndex(
      'backfill_status',
      new TableIndex({
        name: 'IDX_backfill_status_contract_network',
        columnNames: ['contractId', 'network'],
        isUnique: true,
      }),
    );

    // Add index on completed for quick filtering
    await queryRunner.createIndex(
      'backfill_status',
      new TableIndex({
        name: 'IDX_backfill_status_completed',
        columnNames: ['completed'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('backfill_status');
    await queryRunner.dropTable('indexer_cursors');
  }
}
