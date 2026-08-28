import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Creates the user_saves table for song bookmarks (Issue #91).
 *
 * The unique index spans (userId, songId, collection) so a song can appear in
 * several collections but never twice in one — this is what makes the save
 * endpoint idempotent even under concurrent requests.
 */
export class AddUserSaveEntity1753200000010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'user_saves',
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
            name: 'songId',
            type: 'uuid',
          },
          {
            name: 'collection',
            type: 'varchar',
            length: '100',
            default: "'Favorites'",
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

    await queryRunner.createForeignKey(
      'user_saves',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'user_saves',
      new TableForeignKey({
        columnNames: ['songId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'songs',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'user_saves',
      new TableIndex({
        name: 'UQ_user_saves_user_song_collection',
        columnNames: ['userId', 'songId', 'collection'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'user_saves',
      new TableIndex({
        name: 'IDX_user_saves_userId',
        columnNames: ['userId'],
      }),
    );

    await queryRunner.createIndex(
      'user_saves',
      new TableIndex({
        name: 'IDX_user_saves_songId',
        columnNames: ['songId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('user_saves', 'IDX_user_saves_songId');
    await queryRunner.dropIndex('user_saves', 'IDX_user_saves_userId');
    await queryRunner.dropIndex('user_saves', 'UQ_user_saves_user_song_collection');

    const table = await queryRunner.getTable('user_saves');

    for (const columnName of ['songId', 'userId']) {
      const foreignKey = table?.foreignKeys.find(
        (fk) => fk.columnNames.indexOf(columnName) !== -1,
      );
      if (foreignKey) {
        await queryRunner.dropForeignKey('user_saves', foreignKey);
      }
    }

    await queryRunner.dropTable('user_saves');
  }
}
