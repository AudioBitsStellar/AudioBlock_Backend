import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddSongRoyaltySplits1751500000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'songs',
      new TableColumn({
        name: 'royaltySplits',
        type: 'jsonb',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('songs', 'royaltySplits');
  }
}
