import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class AddPlaylistFollow1754500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'playlist_follows',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid' },
          { name: 'playlistId', type: 'uuid' },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'playlist_follows',
      new TableForeignKey({
        name: 'FK_playlist_follow_user',
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'playlist_follows',
      new TableForeignKey({
        name: 'FK_playlist_follow_playlist',
        columnNames: ['playlistId'],
        referencedTableName: 'playlists',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'playlist_follows',
      new TableIndex({ name: 'IDX_playlist_follow_userId', columnNames: ['userId'] }),
    );
    await queryRunner.createIndex(
      'playlist_follows',
      new TableIndex({ name: 'IDX_playlist_follow_playlistId', columnNames: ['playlistId'] }),
    );
    await queryRunner.createIndex(
      'playlist_follows',
      new TableIndex({
        name: 'UQ_playlist_follow_user_playlist',
        columnNames: ['userId', 'playlistId'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('playlist_follows', 'UQ_playlist_follow_user_playlist');
    await queryRunner.dropIndex('playlist_follows', 'IDX_playlist_follow_playlistId');
    await queryRunner.dropIndex('playlist_follows', 'IDX_playlist_follow_userId');
    await queryRunner.dropForeignKey('playlist_follows', 'FK_playlist_follow_playlist');
    await queryRunner.dropForeignKey('playlist_follows', 'FK_playlist_follow_user');
    await queryRunner.dropTable('playlist_follows');
  }
}
