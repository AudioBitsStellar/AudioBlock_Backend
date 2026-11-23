import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWaveformPeaks1729468800001 implements MigrationInterface {
  name = 'AddWaveformPeaks1729468800001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "songs" ADD "waveformPeaks" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "songs" DROP COLUMN "waveformPeaks"`);
  }
}
