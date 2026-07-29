import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableUnique } from 'typeorm';

export class AddTags1753000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'tags',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'name', type: 'varchar', isUnique: true },
          { name: 'slug', type: 'varchar', isUnique: true },
          { name: 'category', type: 'varchar', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'song_tags',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'songId', type: 'uuid' },
          { name: 'tagId', type: 'uuid' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'song_tags',
      new TableForeignKey({
        name: 'FK_song_tag_song',
        columnNames: ['songId'],
        referencedTableName: 'songs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'song_tags',
      new TableForeignKey({
        name: 'FK_song_tag_tag',
        columnNames: ['tagId'],
        referencedTableName: 'tags',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createUniqueConstraint(
      'song_tags',
      new TableUnique({ name: 'UQ_song_tag_song_tag', columnNames: ['songId', 'tagId'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropUniqueConstraint('song_tags', 'UQ_song_tag_song_tag');
    await queryRunner.dropForeignKey('song_tags', 'FK_song_tag_tag');
    await queryRunner.dropForeignKey('song_tags', 'FK_song_tag_song');
    await queryRunner.dropTable('song_tags');
    await queryRunner.dropTable('tags');
  }
}
