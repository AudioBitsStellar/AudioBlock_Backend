import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Migration to add a free-trial period to subscriptions (Issue #416).
 *
 * Adds a nullable `trialEndsAt` column. While set and in the future, the
 * subscription grants its gated features without billing; once the date
 * passes, SubscriptionService finalises the trial into a billed subscription.
 */
export class AddSubscriptionTrial1754000000000 implements MigrationInterface {
  name = 'AddSubscriptionTrial1754000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'subscriptions',
      new TableColumn({
        name: 'trialEndsAt',
        type: 'timestamp',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('subscriptions', 'trialEndsAt');
  }
}
