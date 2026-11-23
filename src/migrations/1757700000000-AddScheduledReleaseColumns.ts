import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

/**
 * Adds scheduled-publishing columns to the releases table (Issue #423).
 *
 * - `status`      – lifecycle state: draft | scheduled | published (default published)
 * - `scheduledAt` – future UTC timestamp when the release should auto-publish
 * - `publishedAt` – when the release became publicly live
 *
 * A composite index on (status, scheduledAt) makes the cron/job query that
 * finds due-to-publish releases efficient even at large table sizes.
 */
export class AddScheduledReleaseColumns1757700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'releases',
      new TableColumn({
        name: 'status',
        type: 'varchar',
        length: '50',
        default: "'published'",
      }),
    );

    await queryRunner.addColumn(
      'releases',
      new TableColumn({
        name: 'scheduledAt',
        type: 'timestamp',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'releases',
      new TableColumn({
        name: 'publishedAt',
        type: 'timestamp',
        isNullable: true,
      }),
    );

    await queryRunner.createIndex(
      'releases',
      new TableIndex({
        name: 'IDX_releases_status_scheduledAt',
        columnNames: ['status', 'scheduledAt'],
      }),
    );

    await queryRunner.query(`
      ALTER TABLE "releases"
      ADD CONSTRAINT "CHK_releases_status_valid"
      CHECK (status IN ('draft', 'scheduled', 'published'));
    `);

    // A scheduled release must always have a target time.
    await queryRunner.query(`
      ALTER TABLE "releases"
      ADD CONSTRAINT "CHK_releases_scheduled_has_date"
      CHECK (status <> 'scheduled' OR "scheduledAt" IS NOT NULL);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "releases"
      DROP CONSTRAINT IF EXISTS "CHK_releases_scheduled_has_date";
    `);

    await queryRunner.query(`
      ALTER TABLE "releases"
      DROP CONSTRAINT IF EXISTS "CHK_releases_status_valid";
    `);

    await queryRunner.dropIndex('releases', 'IDX_releases_status_scheduledAt');

    await queryRunner.dropColumn('releases', 'publishedAt');
    await queryRunner.dropColumn('releases', 'scheduledAt');
    await queryRunner.dropColumn('releases', 'status');
  }
}
