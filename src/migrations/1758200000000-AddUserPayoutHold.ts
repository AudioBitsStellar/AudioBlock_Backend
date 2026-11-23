import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Payout compliance hold (#985).
 *
 * `payoutHoldReason` being non-null excludes the account from royalty payouts.
 * `payoutHoldPlacedAt` records when the hold was placed for the audit trail.
 * Both columns are nullable, so existing accounts are unaffected.
 */
export class AddUserPayoutHold1758200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('users', [
      new TableColumn({ name: 'payoutHoldReason', type: 'varchar', isNullable: true }),
      new TableColumn({ name: 'payoutHoldPlacedAt', type: 'timestamp', isNullable: true }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'payoutHoldPlacedAt');
    await queryRunner.dropColumn('users', 'payoutHoldReason');
  }
}
