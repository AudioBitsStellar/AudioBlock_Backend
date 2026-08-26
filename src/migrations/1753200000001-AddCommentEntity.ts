import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Creates the comments table for song comments and nested replies (Issue #90).
 *
 * `parentId` self-references the table so a reply cascades away with its parent.
 * `depth` is constrained to 1..3 in the database as well as the service, so the
 * nesting limit holds even for writes that bypass the application.
 */
export class AddCommentEntity1753200000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'comments',
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
            name: 'songId',
            type: 'uuid',
          },
          {
            name: 'text',
            type: 'text',
          },
          {
            name: 'parentId',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'depth',
            type: 'int',
            default: 1,
          },
          {
            name: 'edited',
            type: 'boolean',
            default: false,
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
      'comments',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'comments',
      new TableForeignKey({
        columnNames: ['songId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'songs',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'comments',
      new TableForeignKey({
        columnNames: ['parentId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'comments',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'comments',
      new TableIndex({
        name: 'IDX_comments_songId',
        columnNames: ['songId'],
      }),
    );

    await queryRunner.createIndex(
      'comments',
      new TableIndex({
        name: 'IDX_comments_userId',
        columnNames: ['userId'],
      }),
    );

    await queryRunner.createIndex(
      'comments',
      new TableIndex({
        name: 'IDX_comments_parentId',
        columnNames: ['parentId'],
      }),
    );

    // Enforce the 3-level nesting limit and the 2000-character body limit at
    // the database layer too, so the invariants survive direct SQL writes.
    await queryRunner.query(`
      ALTER TABLE "comments"
      ADD CONSTRAINT "CHK_comments_depth_valid"
      CHECK (depth >= 1 AND depth <= 3);
    `);

    await queryRunner.query(`
      ALTER TABLE "comments"
      ADD CONSTRAINT "CHK_comments_text_length"
      CHECK (char_length(text) BETWEEN 1 AND 2000);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "comments"
      DROP CONSTRAINT IF EXISTS "CHK_comments_text_length";
    `);

    await queryRunner.query(`
      ALTER TABLE "comments"
      DROP CONSTRAINT IF EXISTS "CHK_comments_depth_valid";
    `);

    await queryRunner.dropIndex('comments', 'IDX_comments_parentId');
    await queryRunner.dropIndex('comments', 'IDX_comments_userId');
    await queryRunner.dropIndex('comments', 'IDX_comments_songId');

    const table = await queryRunner.getTable('comments');

    for (const columnName of ['parentId', 'songId', 'userId']) {
      const foreignKey = table?.foreignKeys.find(
        (fk) => fk.columnNames.indexOf(columnName) !== -1,
      );
      if (foreignKey) {
        await queryRunner.dropForeignKey('comments', foreignKey);
      }
    }

    await queryRunner.dropTable('comments');
  }
}
