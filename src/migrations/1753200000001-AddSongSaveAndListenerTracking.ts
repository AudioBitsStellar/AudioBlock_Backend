import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

/**
 * Statistics data sources (Issue #87): a `song_saves` table backing the saves
 * metric, plus listener identity columns on `song_play_events` so unique
 * listener counts can be derived per time window.
 */
export class AddSongSaveAndListenerTracking1753200000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'song_saves',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'songId', type: 'uuid' },
          { name: 'userId', type: 'uuid' },
          { name: 'savedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'song_saves',
      new TableForeignKey({
        name: 'FK_song_save_song',
        columnNames: ['songId'],
        referencedTableName: 'songs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'song_saves',
      new TableForeignKey({
        name: 'FK_song_save_user',
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'song_saves',
      new TableIndex({ name: 'IDX_song_save_songId', columnNames: ['songId'] }),
    );
    await queryRunner.createIndex(
      'song_saves',
      new TableIndex({ name: 'IDX_song_save_userId', columnNames: ['userId'] }),
    );
    await queryRunner.createIndex(
      'song_saves',
      new TableIndex({ name: 'IDX_song_save_savedAt', columnNames: ['savedAt'] }),
    );
    await queryRunner.createIndex(
      'song_saves',
      new TableIndex({
        name: 'UQ_song_save_user_song',
        columnNames: ['songId', 'userId'],
        isUnique: true,
      }),
    );

    await queryRunner.addColumns('song_play_events', [
      new TableColumn({ name: 'listenerId', type: 'uuid', isNullable: true }),
      new TableColumn({ name: 'listenerKey', type: 'varchar', isNullable: true }),
    ]);

    await queryRunner.createIndex(
      'song_play_events',
      new TableIndex({ name: 'IDX_song_play_event_listenerId', columnNames: ['listenerId'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('song_play_events', 'IDX_song_play_event_listenerId');
    await queryRunner.dropColumns('song_play_events', ['listenerKey', 'listenerId']);

    await queryRunner.dropIndex('song_saves', 'UQ_song_save_user_song');
    await queryRunner.dropIndex('song_saves', 'IDX_song_save_savedAt');
    await queryRunner.dropIndex('song_saves', 'IDX_song_save_userId');
    await queryRunner.dropIndex('song_saves', 'IDX_song_save_songId');
    await queryRunner.dropForeignKey('song_saves', 'FK_song_save_user');
    await queryRunner.dropForeignKey('song_saves', 'FK_song_save_song');
    await queryRunner.dropTable('song_saves');
  }
}
