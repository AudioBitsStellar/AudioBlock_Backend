import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableUnique } from 'typeorm';

export class AddSongCollaborator1753000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'song_collaborators',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'songId', type: 'uuid' },
          { name: 'userId', type: 'uuid' },
          { name: 'role', type: 'varchar' },
          { name: 'royaltyShare', type: 'float' },
          { name: 'status', type: 'varchar', default: `'active'` },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'song_collaborators',
      new TableForeignKey({
        name: 'FK_song_collaborator_song',
        columnNames: ['songId'],
        referencedTableName: 'songs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'song_collaborators',
      new TableForeignKey({
        name: 'FK_song_collaborator_user',
        columnNames: ['userId'],
        referencedTableName: 'user',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createUniqueConstraint(
      'song_collaborators',
      new TableUnique({
        name: 'UQ_song_collaborator_song_user',
        columnNames: ['songId', 'userId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropUniqueConstraint('song_collaborators', 'UQ_song_collaborator_song_user');
    await queryRunner.dropForeignKey('song_collaborators', 'FK_song_collaborator_user');
    await queryRunner.dropForeignKey('song_collaborators', 'FK_song_collaborator_song');
    await queryRunner.dropTable('song_collaborators');
  }
}
