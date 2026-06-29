import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from "typeorm";

export class AddSongModeration1751236800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns("song", [
      new TableColumn({
        name: "flagged",
        type: "boolean",
        default: false,
      }),
      new TableColumn({
        name: "flaggedAt",
        type: "timestamp",
        isNullable: true,
      }),
      new TableColumn({
        name: "flaggedBy",
        type: "uuid",
        isNullable: true,
      }),
      new TableColumn({
        name: "flagReason",
        type: "text",
        isNullable: true,
      }),
    ]);

    await queryRunner.createIndex(
      "song",
      new TableIndex({
        name: "IDX_song_flagged",
        columnNames: ["flagged"],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex("song", "IDX_song_flagged");
    await queryRunner.dropColumns("song", ["flagReason", "flaggedBy", "flaggedAt", "flagged"]);
  }
}
