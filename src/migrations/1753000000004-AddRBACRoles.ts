import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to add MODERATOR and SUPER_ADMIN roles to the UserRole enum.
 * Updates the User table's role column to support the new roles.
 */
export class AddRBACRoles1753000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL doesn't have a direct way to add enum values to an existing varchar column
    // Since the role column is varchar, we just need to ensure the default is still valid
    // No schema changes needed - the varchar column can already store any string value

    // Optional: Add a check constraint to enforce valid role values
    await queryRunner.query(`
      ALTER TABLE "user"
      DROP CONSTRAINT IF EXISTS "CHK_user_role_valid";
    `);

    await queryRunner.query(`
      ALTER TABLE "user"
      ADD CONSTRAINT "CHK_user_role_valid"
      CHECK (role IN ('listener', 'artist', 'moderator', 'admin', 'super_admin'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the check constraint
    await queryRunner.query(`
      ALTER TABLE "user"
      DROP CONSTRAINT IF EXISTS "CHK_user_role_valid";
    `);

    // Re-add the old constraint with only the original roles
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD CONSTRAINT "CHK_user_role_valid"
      CHECK (role IN ('listener', 'artist', 'admin'));
    `);

    // Note: Any users with moderator or super_admin roles will need to be
    // manually updated before running this down migration
  }
}
