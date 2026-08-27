import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class AddSongPlayEvent1753000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'song_play_events',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'songId', type: 'uuid' },
          { name: 'playedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'song_play_events',
      new TableForeignKey({
        name: 'FK_song_play_event_song',
        columnNames: ['songId'],
        referencedTableName: 'songs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'song_play_events',
      new TableIndex({ name: 'IDX_song_play_event_songId', columnNames: ['songId'] }),
    );
    await queryRunner.createIndex(
      'song_play_events',
      new TableIndex({ name: 'IDX_song_play_event_playedAt', columnNames: ['playedAt'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('song_play_events', 'FK_song_play_event_song');
    await queryRunner.dropTable('song_play_events');
  }
}
