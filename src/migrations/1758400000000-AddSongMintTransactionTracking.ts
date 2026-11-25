import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddSongMintTransactionTracking1758400000000 implements MigrationInterface {
  name = 'AddSongMintTransactionTracking1758400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'songs',
      new TableColumn({ name: 'mintTxHash', type: 'varchar', isNullable: true }),
    );
    await queryRunner.addColumn(
      'songs',
      new TableColumn({ name: 'mintSubmittedAt', type: 'timestamp', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('songs', 'mintSubmittedAt');
    await queryRunner.dropColumn('songs', 'mintTxHash');
  }
}
