import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Ensures the RBAC `role` column exists on the users table (Issue #100).
 *
 * The column was introduced in the initial schema as `varchar(50)` with a
 * default of `'listener'`. Because roles are stored as strings, the new
 * `moderator` and `super_admin` values require no structural change — this
 * migration is an idempotent safety net that (re)creates the column for any
 * database provisioned without it, keeping fresh and legacy environments in
 * sync with the {@link UserRole} enum.
 */
export class AddRbacRolesToUser1751600000000 implements MigrationInterface {
  private readonly table = 'user';
  private readonly column = 'role';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasColumn = await queryRunner.hasColumn(this.table, this.column);
    if (!hasColumn) {
      await queryRunner.addColumn(
        this.table,
        new TableColumn({
          name: this.column,
          type: 'varchar',
          length: '50',
          default: "'listener'",
        }),
      );
    }
  }

  public async down(): Promise<void> {
    // Intentionally a no-op: `role` is a core authentication field and is owned
    // by the initial schema migration. Dropping it here would break login for
    // every user, so this migration does not remove it on rollback.
  }
}
