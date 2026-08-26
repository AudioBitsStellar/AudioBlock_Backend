import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Creates the playlists and playlist_songs tables (Issue #77).
 *
 * A playlist belongs to exactly one user and is deleted when that user is
 * removed (CASCADE). Playlist songs form an ordered many-to-many join: the
 * (playlistId, songId) unique index prevents duplicate songs, and the
 * position column drives the ordered listing returned by the API.
 */
export class AddPlaylistEntities1753200000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'playlists',
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
            name: 'name',
            type: 'varchar',
            length: '200',
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'isPublic',
            type: 'boolean',
            default: 'true',
          },
          {
            name: 'coverImageUrl',
            type: 'varchar',
            length: '500',
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

    await queryRunner.createTable(
      new Table({
        name: 'playlist_songs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'playlistId',
            type: 'uuid',
          },
          {
            name: 'songId',
            type: 'uuid',
          },
          {
            name: 'position',
            type: 'int',
            default: 0,
          },
          {
            name: 'addedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'playlists',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'playlist_songs',
      new TableForeignKey({
        columnNames: ['playlistId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'playlists',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'playlist_songs',
      new TableForeignKey({
        columnNames: ['songId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'songs',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'playlists',
      new TableIndex({
        name: 'IDX_playlists_userId',
        columnNames: ['userId'],
      }),
    );

    await queryRunner.createIndex(
      'playlist_songs',
      new TableIndex({
        name: 'UQ_playlist_songs_playlist_song',
        columnNames: ['playlistId', 'songId'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'playlist_songs',
      new TableIndex({
        name: 'IDX_playlist_songs_playlistId_position',
        columnNames: ['playlistId', 'position'],
      }),
    );

    await queryRunner.createIndex(
      'playlist_songs',
      new TableIndex({
        name: 'IDX_playlist_songs_songId',
        columnNames: ['songId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('playlist_songs', 'IDX_playlist_songs_songId');
    await queryRunner.dropIndex('playlist_songs', 'IDX_playlist_songs_playlistId_position');
    await queryRunner.dropIndex('playlist_songs', 'UQ_playlist_songs_playlist_song');
    await queryRunner.dropIndex('playlists', 'IDX_playlists_userId');

    const playlistSongsTable = await queryRunner.getTable('playlist_songs');
    for (const columnName of ['playlistId', 'songId']) {
      const foreignKey = playlistSongsTable?.foreignKeys.find(
        (fk) => fk.columnNames.indexOf(columnName) !== -1,
      );
      if (foreignKey) {
        await queryRunner.dropForeignKey('playlist_songs', foreignKey);
      }
    }

    const playlistsTable = await queryRunner.getTable('playlists');
    const playlistUserFk = playlistsTable?.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('userId') !== -1,
    );
    if (playlistUserFk) {
      await queryRunner.dropForeignKey('playlists', playlistUserFk);
    }

    await queryRunner.dropTable('playlist_songs');
    await queryRunner.dropTable('playlists');
  }
}
