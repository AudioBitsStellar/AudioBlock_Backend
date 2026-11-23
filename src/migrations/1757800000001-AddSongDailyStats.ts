import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the song_daily_stats table so daily play counts are persisted and
 * queryable without reprocessing the raw play-event log. (#794)
 */
export class AddSongDailyStats1757800000001 implements MigrationInterface {
  name = 'AddSongDailyStats1757800000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS song_daily_stats (
        id          BIGSERIAL PRIMARY KEY,
        song_id     UUID        NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        date        DATE        NOT NULL,
        play_count  INTEGER     NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_song_daily_stats_song_date UNIQUE (song_id, date)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_song_daily_stats_song_id
        ON song_daily_stats (song_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_song_daily_stats_date
        ON song_daily_stats (date DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS song_daily_stats;`);
  }
}
