import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Migration to add trial period support to the subscriptions table.
 * Adds isTrial, trialDaysUsed, and trialDurationDays columns.
 */
export class AddTrialPeriodSupport1753200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add isTrial column
    await queryRunner.addColumn(
      'subscriptions',
      new TableColumn({
        name: 'isTrial',
        type: 'boolean',
        default: false,
      }),
    );

    // Add trialDaysUsed column
    await queryRunner.addColumn(
      'subscriptions',
      new TableColumn({
        name: 'trialDaysUsed',
        type: 'int',
        default: 0,
      }),
    );

    // Add trialDurationDays column
    await queryRunner.addColumn(
      'subscriptions',
      new TableColumn({
        name: 'trialDurationDays',
        type: 'int',
        isNullable: true,
      }),
    );

    // Update status check constraint to include 'trial'
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      DROP CONSTRAINT "CHK_subscriptions_status_valid";
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD CONSTRAINT "CHK_subscriptions_status_valid"
      CHECK (status IN ('active', 'cancelled', 'expired', 'trial'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove columns
    await queryRunner.dropColumn('subscriptions', 'trialDurationDays');
    await queryRunner.dropColumn('subscriptions', 'trialDaysUsed');
    await queryRunner.dropColumn('subscriptions', 'isTrial');

    // Restore status check constraint
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      DROP CONSTRAINT "CHK_subscriptions_status_valid";
    `);

    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD CONSTRAINT "CHK_subscriptions_status_valid"
      CHECK (status IN ('active', 'cancelled', 'expired'));
    `);
  }
}
