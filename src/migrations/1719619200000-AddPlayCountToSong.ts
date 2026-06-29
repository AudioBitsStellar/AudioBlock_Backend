import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddPlayCountToSong1719619200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      "song",
      new TableColumn({
        name: "playCount",
        type: "int",
        default: 0,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("song", "playCount");
  }
}