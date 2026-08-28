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
    const hasColumn = await queryRunner.hasColumn('songs', 'genreId');
    if (!hasColumn) {
      await queryRunner.addColumn(
        'songs',
        new TableColumn({
          name: 'genreId',
          type: 'uuid',
          isNullable: true,
        }),
      );
    }

    const table = await queryRunner.getTable('songs');
    const hasFk = table?.foreignKeys.some((fk) => fk.columnNames.includes('genreId'));
    if (!hasFk) {
      // Genre entity uses table 'genre' (singular) via @Entity() default
      const referencedTable = (await queryRunner.hasTable('genre')) ? 'genre' : 'genres';
      await queryRunner.createForeignKey(
        'songs',
        new TableForeignKey({
          columnNames: ['genreId'],
          referencedColumnNames: ['id'],
          referencedTableName: referencedTable,
          onDelete: 'SET NULL',
        }),
      );
    }

    const hasIndex = table?.indices.some((idx) => idx.name === 'IDX_songs_genreId');
    if (!hasIndex) {
      await queryRunner.createIndex(
        'songs',
        new TableIndex({
          name: 'IDX_songs_genreId',
          columnNames: ['genreId'],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('songs');
    if (table?.indices.some((idx) => idx.name === 'IDX_songs_genreId')) {
      await queryRunner.dropIndex('songs', 'IDX_songs_genreId');
    }

    const refreshed = await queryRunner.getTable('songs');
    const foreignKey = refreshed?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('genreId') !== -1,
    );
    if (foreignKey) {
      await queryRunner.dropForeignKey('songs', foreignKey);
    }

    // Do not drop genreId column itself — it is part of the baseline
    // CreateInitialSchema (songs table) for fresh DBs where this migration
    // was a no-op. Dropping it would remove a column owned by the initial schema.
  }
}
