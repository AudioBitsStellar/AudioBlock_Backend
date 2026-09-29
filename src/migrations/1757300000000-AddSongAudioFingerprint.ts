import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddSongAudioFingerprint1757300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('songs', [
      new TableColumn({
        name: 'fingerprint',
        type: 'text',
        isNullable: true,
      }),
      new TableColumn({
        name: 'isNearDuplicate',
        type: 'boolean',
        default: false,
      }),
      new TableColumn({
        name: 'duplicateOfSongId',
        type: 'varchar',
        isNullable: true,
      }),
      new TableColumn({
        name: 'duplicateSimilarityScore',
        type: 'float',
        isNullable: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('songs', 'duplicateSimilarityScore');
    await queryRunner.dropColumn('songs', 'duplicateOfSongId');
    await queryRunner.dropColumn('songs', 'isNearDuplicate');
    await queryRunner.dropColumn('songs', 'fingerprint');
  }
}
