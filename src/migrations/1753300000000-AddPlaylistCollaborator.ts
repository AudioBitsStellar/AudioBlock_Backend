import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Creates the playlist_collaborators table (Issue #406).
 *
 * A single playlist can be co-edited by multiple users. Each invited user has
 * exactly one row, keyed by (playlistId, userId). The `role` column carries the
 * per-collaborator edit permission: `editor` may mutate songs, `viewer` may not.
 * Invitations are removed when the playlist or the user is deleted (CASCADE).
 */
export class AddPlaylistCollaborator1753300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'playlist_collaborators',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'playlistId', type: 'uuid' },
          { name: 'userId', type: 'uuid' },
          {
            name: 'role',
            type: 'varchar',
            default: `'editor'`,
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

    await queryRunner.createForeignKey(
      'playlist_collaborators',
      new TableForeignKey({
        name: 'FK_playlist_collab_playlist',
        columnNames: ['playlistId'],
        referencedTableName: 'playlists',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'playlist_collaborators',
      new TableForeignKey({
        name: 'FK_playlist_collab_user',
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createUniqueConstraint(
      'playlist_collaborators',
      new TableUnique({
        name: 'UQ_playlist_collab_playlist_user',
        columnNames: ['playlistId', 'userId'],
      }),
    );

    await queryRunner.createIndex(
      'playlist_collaborators',
      new TableIndex({
        name: 'IDX_playlist_collab_userId',
        columnNames: ['userId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('playlist_collaborators', 'IDX_playlist_collab_userId');
    await queryRunner.dropUniqueConstraint(
      'playlist_collaborators',
      'UQ_playlist_collab_playlist_user',
    );
    const table = await queryRunner.getTable('playlist_collaborators');
    if (table) {
      for (const fk of table.foreignKeys) {
        await queryRunner.dropForeignKey('playlist_collaborators', fk);
      }
    }
    await queryRunner.dropTable('playlist_collaborators');
  }
}
