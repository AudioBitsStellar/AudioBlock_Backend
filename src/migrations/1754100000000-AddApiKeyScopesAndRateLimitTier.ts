import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds the `scopes` and `rateLimitTier` columns to `api_keys`.
 *
 * These columns were added to the `ApiKey` entity (coarse-grained scopes
 * alongside fine-grained `permissions`, and a per-key rate-limit tier) but
 * were never migrated, so `synchronize: true` (dev/test) masked the drift
 * while production — which runs migrations, not sync — was missing both
 * columns entirely. This migration brings the schema back in line with the
 * entity.
 */
export class AddApiKeyScopesAndRateLimitTier1754100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('api_keys');

    if (table && !table.findColumnByName('scopes')) {
      await queryRunner.addColumn(
        'api_keys',
        new TableColumn({
          name: 'scopes',
          type: 'text',
          default: "''",
        }),
      );
    }

    if (table && !table.findColumnByName('rateLimitTier')) {
      await queryRunner.addColumn(
        'api_keys',
        new TableColumn({
          name: 'rateLimitTier',
          type: 'varchar',
          length: '50',
          default: "'standard'",
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('api_keys');

    if (table?.findColumnByName('rateLimitTier')) {
      await queryRunner.dropColumn('api_keys', 'rateLimitTier');
    }

    if (table?.findColumnByName('scopes')) {
      await queryRunner.dropColumn('api_keys', 'scopes');
    }
  }
}
