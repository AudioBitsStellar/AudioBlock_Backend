import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLoudnessFields1729468800000 implements MigrationInterface {
  name = 'AddLoudnessFields1729468800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Fix loudness column type if it's integer (to float/numeric for decimal precision)
    await queryRunner.query(`ALTER TABLE"songs" ALTER COLUMN "loudness" TYPE numeric`);

    // Add new loudness-related columns
    await queryRunner.query(`ALTER TABLE "songs" ADD "truePeakDb" numeric`);
    await queryRunner.query(`ALTER TABLE "songs" ADD "loudnessRange" numeric`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "songs" DROP COLUMN "loudnessRange"`);
    await queryRunner.query(`ALTER TABLE "songs" DROP COLUMN "truePeakDb"`);
    // Reverting loudness type change would lose precision, so we keep it as numeric
  }
}

