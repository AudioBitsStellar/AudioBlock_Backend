import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddPlayCountToSong1719619200003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('songs', 'playCount'))) {
      await queryRunner.addColumn(
        'songs',
        new TableColumn({
          name: 'playCount',
          type: 'int',
          default: 0,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('songs', 'playCount')) {
      await queryRunner.dropColumn('songs', 'playCount');
    }
  }
}
