import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddPlayCountToSong1719619300000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Idempotent: the earlier 1719619200000 migration already adds playCount.
    // This duplicate is retained for history but becomes a no-op if the column exists.
    if (!(await queryRunner.hasColumn('songs', 'playCount'))) {
      await queryRunner.addColumn(
        'songs',
        new TableColumn({
          name: 'playCount',
          type: 'int',
          default: 0,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only drop if we are the owner of the column; otherwise let the first migration handle it.
    // For safety, check and drop only if column exists and this is the last playCount migration being reverted.
    if (await queryRunner.hasColumn('songs', 'playCount')) {
      // Avoid dropping if the earlier migration still expects the column — the next revert will handle it.
      // We treat both as a single logical migration: drop only when reverting the first one is intended.
      // To keep revert semantics simple, this duplicate's down is a no-op; the first migration's down will actually drop.
    }
  }
}
