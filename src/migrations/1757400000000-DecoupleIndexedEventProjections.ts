import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/**
 * Decouples raw event ingestion from derived read models (Issue #261).
 *
 * - Adds a monotonic `ingestSeq` to `indexed_events` so projectors can replay
 *   raw events in a stable order. BIGSERIAL backfills existing rows.
 * - Adds `indexer_projection_checkpoints` to track each projection's position.
 * - Adds the `onchain_event_counts` read model, built only by the projector.
 */
export class DecoupleIndexedEventProjections1757400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "indexed_events" ADD COLUMN "ingestSeq" BIGSERIAL NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_indexed_events_ingestSeq" ON "indexed_events" ("ingestSeq")`,
    );

    await queryRunner.createTable(
      new Table({
        name: 'indexer_projection_checkpoints',
        columns: [
          { name: 'projection', type: 'varchar', length: '100', isPrimary: true },
          { name: 'lastIngestSeq', type: 'bigint', default: 0 },
          { name: 'eventsApplied', type: 'bigint', default: 0 },
          { name: 'lastRebuiltAt', type: 'timestamp', isNullable: true },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'onchain_event_counts',
        columns: [
          { name: 'network', type: 'varchar', length: '50', isPrimary: true },
          { name: 'contractType', type: 'varchar', length: '100', isPrimary: true },
          { name: 'eventType', type: 'varchar', length: '100', isPrimary: true },
          { name: 'count', type: 'bigint', default: 0 },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('onchain_event_counts');
    await queryRunner.dropTable('indexer_projection_checkpoints');
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_indexed_events_ingestSeq"`);
    await queryRunner.query(`ALTER TABLE "indexed_events" DROP COLUMN "ingestSeq"`);
  }
}
