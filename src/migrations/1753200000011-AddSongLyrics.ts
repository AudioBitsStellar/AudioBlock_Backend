import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSongLyrics1753200000011 implements MigrationInterface {
  name = 'AddSongLyrics1753200000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "songs" ADD "lyrics" text`);
    await queryRunner.query(`ALTER TABLE "songs" ADD "language" varchar`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "songs" DROP COLUMN "language"`);
    await queryRunner.query(`ALTER TABLE "songs" DROP COLUMN "lyrics"`);
  }
}
