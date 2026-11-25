import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const tables = ['songs', 'users', 'royalty_payouts', 'transactions_logs'];

export class AddChainNetworkProvenance1758400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of tables) {
      await queryRunner.addColumn(
        table,
        new TableColumn({
          name: 'chainNetwork',
          type: 'varchar',
          length: '16',
          isNullable: true,
        }),
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of tables) {
      await queryRunner.dropColumn(table, 'chainNetwork');
    }
  }
}
