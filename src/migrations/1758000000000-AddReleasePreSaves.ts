import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableUnique,
  TableIndex,
} from 'typeorm';

/**
 * Pre-save campaigns for upcoming releases (Issue #424).
 *
 * `release_pre_saves` records a fan's interest before publish; on publish the
 * rows are fulfilled into `user_saves` so pre-saved releases auto-appear in
 * the fan's library.
 */
export class AddReleasePreSaves1758000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'release_pre_saves',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid' },
          { name: 'releaseId', type: 'uuid' },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'fulfilledAt', type: 'timestamp', isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'release_pre_saves',
      new TableForeignKey({
        name: 'FK_release_pre_save_user',
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'release_pre_saves',
      new TableForeignKey({
        name: 'FK_release_pre_save_release',
        columnNames: ['releaseId'],
        referencedTableName: 'releases',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createUniqueConstraint(
      'release_pre_saves',
      new TableUnique({
        name: 'UQ_release_pre_save_user_release',
        columnNames: ['userId', 'releaseId'],
      }),
    );

    await queryRunner.createIndex(
      'release_pre_saves',
      new TableIndex({ name: 'IDX_release_pre_save_userId', columnNames: ['userId'] }),
    );

    await queryRunner.createIndex(
      'release_pre_saves',
      new TableIndex({ name: 'IDX_release_pre_save_releaseId', columnNames: ['releaseId'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('release_pre_saves', 'IDX_release_pre_save_releaseId');
    await queryRunner.dropIndex('release_pre_saves', 'IDX_release_pre_save_userId');
    await queryRunner.dropUniqueConstraint(
      'release_pre_saves',
      'UQ_release_pre_save_user_release',
    );
    await queryRunner.dropForeignKey('release_pre_saves', 'FK_release_pre_save_release');
    await queryRunner.dropForeignKey('release_pre_saves', 'FK_release_pre_save_user');
    await queryRunner.dropTable('release_pre_saves');
  }
}
