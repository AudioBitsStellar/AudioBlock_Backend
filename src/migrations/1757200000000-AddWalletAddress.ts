import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds wallet_address column to users table for Privy embedded wallet (Issue #601).
 */
export class AddWalletAddress1757200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({ name: 'walletAddress', type: 'varchar', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'walletAddress');
  }
}
