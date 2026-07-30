import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Creates the artist_verifications table for verification badges (Issue #92).
 *
 * Applications are retained after a decision so review history survives, and a
 * partial unique index allows at most one outstanding application per user
 * while still permitting a re-application after a rejection.
 */
export class AddArtistVerificationEntity1753200000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'artist_verifications',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'userId',
            type: 'uuid',
          },
          {
            name: 'status',
            type: 'varchar',
            length: '50',
            default: "'pending'",
          },
          {
            name: 'displayNameProof',
            type: 'varchar',
            length: '200',
          },
          {
            name: 'socialLinks',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'musicLinks',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'notes',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'reviewedBy',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'reviewedAt',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'rejectionReason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'artist_verifications',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    // Reviewer is nullable and set to NULL if the admin account is removed —
    // losing the reviewer must not delete the verification record itself.
    await queryRunner.createForeignKey(
      'artist_verifications',
      new TableForeignKey({
        columnNames: ['reviewedBy'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'SET NULL',
      }),
    );

    await queryRunner.createIndex(
      'artist_verifications',
      new TableIndex({
        name: 'IDX_artist_verifications_userId',
        columnNames: ['userId'],
      }),
    );

    await queryRunner.createIndex(
      'artist_verifications',
      new TableIndex({
        name: 'IDX_artist_verifications_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.query(`
      ALTER TABLE "artist_verifications"
      ADD CONSTRAINT "CHK_artist_verifications_status_valid"
      CHECK (status IN ('pending', 'approved', 'rejected'));
    `);

    // A rejection must always carry a reason the applicant can act on.
    await queryRunner.query(`
      ALTER TABLE "artist_verifications"
      ADD CONSTRAINT "CHK_artist_verifications_rejection_reason"
      CHECK (status <> 'rejected' OR "rejectionReason" IS NOT NULL);
    `);

    // At most one pending application per user; approved/rejected rows are
    // unconstrained so history accumulates.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_artist_verifications_pending_per_user"
      ON "artist_verifications" ("userId")
      WHERE status = 'pending';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_artist_verifications_pending_per_user";
    `);

    await queryRunner.query(`
      ALTER TABLE "artist_verifications"
      DROP CONSTRAINT IF EXISTS "CHK_artist_verifications_rejection_reason";
    `);

    await queryRunner.query(`
      ALTER TABLE "artist_verifications"
      DROP CONSTRAINT IF EXISTS "CHK_artist_verifications_status_valid";
    `);

    await queryRunner.dropIndex('artist_verifications', 'IDX_artist_verifications_status');
    await queryRunner.dropIndex('artist_verifications', 'IDX_artist_verifications_userId');

    const table = await queryRunner.getTable('artist_verifications');

    for (const columnName of ['reviewedBy', 'userId']) {
      const foreignKey = table?.foreignKeys.find(
        (fk) => fk.columnNames.indexOf(columnName) !== -1,
      );
      if (foreignKey) {
        await queryRunner.dropForeignKey('artist_verifications', foreignKey);
      }
    }

    await queryRunner.dropTable('artist_verifications');
  }
}
