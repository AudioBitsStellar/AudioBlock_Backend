import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Creates the tweet_drafts table backing the draft-tweet endpoints added to
 * twitterRoutes.ts. See src/entities/TweetDraft.ts.
 */
export class AddTweetDraft1754300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'tweet_drafts',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid' },
          { name: 'songId', type: 'uuid', isNullable: true },
          { name: 'text', type: 'text' },
          { name: 'status', type: 'varchar', default: "'pending_review'" },
          { name: 'provider', type: 'varchar', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'approvedAt', type: 'timestamp', isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'tweet_drafts',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'tweet_drafts',
      new TableIndex({ name: 'IDX_tweet_drafts_userId', columnNames: ['userId'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('tweet_drafts', 'IDX_tweet_drafts_userId');

    const table = await queryRunner.getTable('tweet_drafts');
    if (table) {
      for (const fk of table.foreignKeys) {
        await queryRunner.dropForeignKey('tweet_drafts', fk);
      }
    }

    await queryRunner.dropTable('tweet_drafts');
  }
}
