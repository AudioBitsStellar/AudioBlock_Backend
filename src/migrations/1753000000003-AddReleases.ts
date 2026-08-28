import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableUnique } from 'typeorm';

export class AddReleases1753000000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'releases',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'title', type: 'varchar' },
          { name: 'artistId', type: 'uuid' },
          { name: 'releaseDate', type: 'timestamp' },
          { name: 'type', type: 'varchar', default: `'albums'` },
          { name: 'coverArt', type: 'varchar', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'release_tracks',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'releaseId', type: 'uuid' },
          { name: 'songId', type: 'uuid' },
          { name: 'trackNumber', type: 'int' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'releases',
      new TableForeignKey({
        name: 'FK_release_artist',
        columnNames: ['artistId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'release_tracks',
      new TableForeignKey({
        name: 'FK_release_track_release',
        columnNames: ['releaseId'],
        referencedTableName: 'releases',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'release_tracks',
      new TableForeignKey({
        name: 'FK_release_track_song',
        columnNames: ['songId'],
        referencedTableName: 'songs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createUniqueConstraint(
      'release_tracks',
      new TableUnique({
        name: 'UQ_release_track_release_song',
        columnNames: ['releaseId', 'songId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropUniqueConstraint('release_tracks', 'UQ_release_track_release_song');
    await queryRunner.dropForeignKey('release_tracks', 'FK_release_track_song');
    await queryRunner.dropForeignKey('release_tracks', 'FK_release_track_release');
    await queryRunner.dropForeignKey('releases', 'FK_release_artist');
    await queryRunner.dropTable('release_tracks');
    await queryRunner.dropTable('releases');
  }
}
