import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Links songs to the Genre entity (Issue #78).
 *
 * Adds a nullable genreId foreign key to the songs table. Existing rows keep
 * their legacy free-text `genre` label; the FK enables genre-based browsing
 * and per-genre song counts for newly tagged content.
 */
export class AddSongGenreRelation1753200000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'songs',
      new TableColumn({
        name: 'genreId',
        type: 'uuid',
        isNullable: true,
      }),
    );

    await queryRunner.createForeignKey(
      'songs',
      new TableForeignKey({
        columnNames: ['genreId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'genres',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createIndex(
      'songs',
      new TableIndex({
        name: 'IDX_songs_genreId',
        columnNames: ['genreId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('songs', 'IDX_songs_genreId');

    const table = await queryRunner.getTable('songs');
    const foreignKey = table?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('genreId') !== -1,
    );
    if (foreignKey) {
      await queryRunner.dropForeignKey('songs', foreignKey);
    }

    await queryRunner.dropColumn('songs', 'genreId');
  }
}
