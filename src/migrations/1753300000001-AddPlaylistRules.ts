import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds smart/rule-based playlist support (Issue #407).
 *
 * Two columns are added to `playlists`:
 *  - `isRuleBased` marks a playlist whose membership is resolved dynamically
 *    from filter criteria instead of a fixed set of stored songs.
 *  - `rule` stores the filter criteria as JSON (tags, genres, savedWithinDays).
 */
export class AddPlaylistRules1753300000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('playlists', [
      new TableColumn({
        name: 'isRuleBased',
        type: 'boolean',
        default: 'false',
      }),
      new TableColumn({
        name: 'rule',
        type: 'json',
        isNullable: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('playlists', ['isRuleBased', 'rule']);
  }
}
