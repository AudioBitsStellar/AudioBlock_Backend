import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds the per-artist `aiStudioEnabled` opt-in flag gating AI Studio tools.
 */
export class AddAiStudioEnabledToUser1757500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({ name: 'aiStudioEnabled', type: 'boolean', default: false }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'aiStudioEnabled');
  }
}
