import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddEmailVerificationAndPasswordResetToUser1719619200001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      "user",
      new TableColumn({
        name: "emailVerified",
        type: "boolean",
        default: false,
      })
    );

    await queryRunner.addColumn(
      "user",
      new TableColumn({
        name: "emailVerificationToken",
        type: "varchar",
        isNullable: true,
      })
    );

    await queryRunner.addColumn(
      "user",
      new TableColumn({
        name: "emailVerificationTokenExpiry",
        type: "timestamp",
        isNullable: true,
      })
    );

    await queryRunner.addColumn(
      "user",
      new TableColumn({
        name: "passwordResetToken",
        type: "varchar",
        isNullable: true,
      })
    );

    await queryRunner.addColumn(
      "user",
      new TableColumn({
        name: "passwordResetTokenExpiry",
        type: "timestamp",
        isNullable: true,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("user", "emailVerified");
    await queryRunner.dropColumn("user", "emailVerificationToken");
    await queryRunner.dropColumn("user", "emailVerificationTokenExpiry");
    await queryRunner.dropColumn("user", "passwordResetToken");
    await queryRunner.dropColumn("user", "passwordResetTokenExpiry");
  }
}