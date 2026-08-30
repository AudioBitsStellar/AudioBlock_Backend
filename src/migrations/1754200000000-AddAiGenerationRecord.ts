import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Creates the ai_generation_records table: a minimal audit trail for async
 * AI-assisted generation jobs (cover art / description), per ADR-007's data
 * retention requirement. See src/entities/AiGenerationRecord.ts.
 */
export class AddAiGenerationRecord1754200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'ai_generation_records',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'songId', type: 'uuid' },
          { name: 'userId', type: 'uuid' },
          { name: 'feature', type: 'varchar' },
          { name: 'status', type: 'varchar', default: "'pending'" },
          { name: 'provider', type: 'varchar', isNullable: true },
          { name: 'resultText', type: 'text', isNullable: true },
          { name: 'resultUrl', type: 'varchar', isNullable: true },
          { name: 'errorMessage', type: 'text', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'completedAt', type: 'timestamp', isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'ai_generation_records',
      new TableForeignKey({
        columnNames: ['songId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'songs',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'ai_generation_records',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'ai_generation_records',
      new TableIndex({ name: 'IDX_ai_generation_records_songId', columnNames: ['songId'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('ai_generation_records', 'IDX_ai_generation_records_songId');

    const table = await queryRunner.getTable('ai_generation_records');
    if (table) {
      for (const fk of table.foreignKeys) {
        await queryRunner.dropForeignKey('ai_generation_records', fk);
      }
    }

    await queryRunner.dropTable('ai_generation_records');
  }
}
