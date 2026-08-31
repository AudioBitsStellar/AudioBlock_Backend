import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class AddCommentReport1754500000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'comments',
      new TableColumn({ name: 'flagged', type: 'boolean', default: false }),
    );
    await queryRunner.addColumn(
      'comments',
      new TableColumn({ name: 'flaggedAt', type: 'timestamp', isNullable: true }),
    );
    await queryRunner.addColumn(
      'comments',
      new TableColumn({ name: 'flagReason', type: 'text', isNullable: true }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'comment_reports',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'commentId', type: 'uuid' },
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
      'comment_reports',
      new TableForeignKey({
        name: 'FK_comment_report_comment',
        columnNames: ['commentId'],
        referencedTableName: 'comments',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'comment_reports',
      new TableForeignKey({
        name: 'FK_comment_report_reporter',
        columnNames: ['reporterId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'comment_reports',
      new TableIndex({ name: 'IDX_comment_report_commentId', columnNames: ['commentId'] }),
    );
    await queryRunner.createIndex(
      'comment_reports',
      new TableIndex({ name: 'IDX_comment_report_reporterId', columnNames: ['reporterId'] }),
    );
    await queryRunner.createIndex(
      'comment_reports',
      new TableIndex({ name: 'IDX_comment_report_status', columnNames: ['status'] }),
    );
    await queryRunner.createIndex(
      'comment_reports',
      new TableIndex({
        name: 'UQ_comment_report_reporter_comment',
        columnNames: ['commentId', 'reporterId'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('comment_reports', 'UQ_comment_report_reporter_comment');
    await queryRunner.dropIndex('comment_reports', 'IDX_comment_report_status');
    await queryRunner.dropIndex('comment_reports', 'IDX_comment_report_reporterId');
    await queryRunner.dropIndex('comment_reports', 'IDX_comment_report_commentId');
    await queryRunner.dropForeignKey('comment_reports', 'FK_comment_report_reporter');
    await queryRunner.dropForeignKey('comment_reports', 'FK_comment_report_comment');
    await queryRunner.dropTable('comment_reports');

    await queryRunner.dropColumn('comments', 'flagReason');
    await queryRunner.dropColumn('comments', 'flaggedAt');
    await queryRunner.dropColumn('comments', 'flagged');
  }
}
