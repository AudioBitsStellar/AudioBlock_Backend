import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Marketplace listing lifecycle table (#920).
 *
 * The relay is sign-locally, so before this table the backend kept no record of
 * what it had put on-chain: a listing whose transaction never confirmed and an
 * auction whose end time passed unbid were both invisible, and there was nothing
 * for a scheduled job to transition.
 *
 * Column types mirror `src/entities/MarketplaceListing.ts` exactly — the schema
 * drift check (#926) diffs this table against the entity and fails on any gap.
 * `endsAt` is nullable and only ever set for auctions, because a fixed-price
 * listing has no on-chain deadline to expire against.
 */
export class AddMarketplaceListings1758400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'marketplace_listings',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'tokenId', type: 'bigint' },
          { name: 'kind', type: 'varchar' },
          { name: 'sellerPublicKey', type: 'varchar' },
          { name: 'priceStroops', type: 'bigint', isNullable: true },
          { name: 'status', type: 'varchar' },
          { name: 'txHash', type: 'varchar', isNullable: true },
          { name: 'endsAt', type: 'timestamp', isNullable: true },
          { name: 'confirmedAt', type: 'timestamp', isNullable: true },
          { name: 'failureReason', type: 'text', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'marketplace_listings',
      new TableIndex({
        name: 'IDX_marketplace_listings_status_ends_at',
        columnNames: ['status', 'endsAt'],
      }),
    );

    await queryRunner.createIndex(
      'marketplace_listings',
      new TableIndex({
        name: 'IDX_marketplace_listings_token_id',
        columnNames: ['tokenId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('marketplace_listings', 'IDX_marketplace_listings_token_id');
    await queryRunner.dropIndex('marketplace_listings', 'IDX_marketplace_listings_status_ends_at');
    await queryRunner.dropTable('marketplace_listings');
  }
}
