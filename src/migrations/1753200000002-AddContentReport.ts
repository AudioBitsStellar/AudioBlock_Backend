import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Content moderation reports (Issue #88): `content_reports` holds user-submitted
 * flags against songs. The unique `(songId, reporterId)` index enforces one
 * report per user per song at the database level.
 */
export class AddContentReport1753200000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'content_reports',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'songId', type: 'uuid' },
          { name: 'reporterId', type: 'uuid' },
          { name: 'reason', type: 'varchar', default: "'other'" },
          { name: 'description', type: 'text', isNullable: true },
          { name: 'status', type: 'varchar', default: "'pending'" },
          { name: 'actionTaken', type: 'varchar', isNullable: true },
          { name: 'resolvedBy', type: 'uuid', isNullable: true },
          { name: 'resolvedAt', type: 'timestamp', isNullable: true },
          { name: 'resolutionNote', type: 'text', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'content_reports',
      new TableForeignKey({
        name: 'FK_content_report_song',
        columnNames: ['songId'],
        referencedTableName: 'songs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'content_reports',
      new TableForeignKey({
        name: 'FK_content_report_reporter',
        columnNames: ['reporterId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'content_reports',
      new TableIndex({ name: 'IDX_content_report_songId', columnNames: ['songId'] }),
    );
    await queryRunner.createIndex(
      'content_reports',
      new TableIndex({ name: 'IDX_content_report_reporterId', columnNames: ['reporterId'] }),
    );
    await queryRunner.createIndex(
      'content_reports',
      new TableIndex({ name: 'IDX_content_report_status', columnNames: ['status'] }),
    );
    await queryRunner.createIndex(
      'content_reports',
      new TableIndex({
        name: 'UQ_content_report_reporter_song',
        columnNames: ['songId', 'reporterId'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('content_reports', 'UQ_content_report_reporter_song');
    await queryRunner.dropIndex('content_reports', 'IDX_content_report_status');
    await queryRunner.dropIndex('content_reports', 'IDX_content_report_reporterId');
    await queryRunner.dropIndex('content_reports', 'IDX_content_report_songId');
    await queryRunner.dropForeignKey('content_reports', 'FK_content_report_reporter');
    await queryRunner.dropForeignKey('content_reports', 'FK_content_report_song');
    await queryRunner.dropTable('content_reports');
  }
}
