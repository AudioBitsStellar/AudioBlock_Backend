import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Maps legacy free-text song genres to Genre relations.
 * Down is lossy: it clears genreId mappings while preserving legacy genre text.
 */
export class MigrateSongGenres1753200000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const genreTable = (await queryRunner.hasTable('genre')) ? 'genre' : 'genres';
    const aliases: Record<string, string> = {
      'hip hop': 'Hip-Hop',
      'hip-hop': 'Hip-Hop',
      'rnb': 'R&B',
      'rhythm and blues': 'R&B',
    };
    const rows = await queryRunner.query(
      'SELECT id, genre FROM songs WHERE genre IS NOT NULL AND genre <> \'\'',
    );
    for (const row of rows as Array<{ id: string; genre: string }>) {
      const normalized = row.genre.trim().toLowerCase();
      const targetName = aliases[normalized] || row.genre.trim();
      let genre = await queryRunner.query(
        `SELECT id, name FROM "${genreTable}" WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [targetName],
      );
      if (!genre.length) {
        console.warn(`[genre migration] unmatched song genre; manual review required: "${row.genre}" (song ${row.id})`);
        continue;
      }
      await queryRunner.query('UPDATE songs SET "genreId" = $1 WHERE id = $2', [
        genre[0].id,
        row.id,
      ]);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('UPDATE songs SET "genreId" = NULL');
  }
}
