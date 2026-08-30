import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddEmailVerificationAndPasswordResetToUser1719619200001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'emailVerified',
        type: 'boolean',
        default: false,
      }),
    );

    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'emailVerificationToken',
        type: 'varchar',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'emailVerificationTokenExpiry',
        type: 'timestamp',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'passwordResetToken',
        type: 'varchar',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'passwordResetTokenExpiry',
        type: 'timestamp',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'emailVerified');
    await queryRunner.dropColumn('users', 'emailVerificationToken');
    await queryRunner.dropColumn('users', 'emailVerificationTokenExpiry');
    await queryRunner.dropColumn('users', 'passwordResetToken');
    await queryRunner.dropColumn('users', 'passwordResetTokenExpiry');
  }
}
