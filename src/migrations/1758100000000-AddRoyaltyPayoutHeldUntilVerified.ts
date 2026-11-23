import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `heldUntilVerified` to `royalty_payouts` (#979).
 *
 * Payouts recorded for an artist who has not been verified are held until the
 * verification is approved. Existing rows default to `false`, so nothing that
 * is already recorded is retroactively held.
 */
export class AddRoyaltyPayoutHeldUntilVerified1758100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'royalty_payouts',
      new TableColumn({
        name: 'heldUntilVerified',
        type: 'boolean',
        default: false,
        isNullable: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('royalty_payouts', 'heldUntilVerified');
  }
}
