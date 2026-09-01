import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

/**
 * Song versioning (Issue #86): `song_versions` records every revision of a
 * song, with a unique `(songId, versionNumber)` pair and one active row per
 * song. Previous revisions keep their own IPFS CID and S3 URL.
 */
export class AddSongVersion1753200000008 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'song_versions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'songId', type: 'uuid' },
          { name: 'versionNumber', type: 'int' },
          { name: 'isActive', type: 'boolean', default: false },
          { name: 'title', type: 'varchar', isNullable: true },
          { name: 'description', type: 'varchar', isNullable: true },
          { name: 'genre', type: 'varchar', isNullable: true },
          { name: 'composers', type: 'varchar', isNullable: true },
          { name: 'coverArtPath', type: 'varchar', isNullable: true },
          { name: 's3OriginalUrl', type: 'varchar', isNullable: true },
          { name: 'hlsMasterUrl', type: 'varchar', isNullable: true },
          { name: 'ipfsCid', type: 'varchar', isNullable: true },
          { name: 'metadataCid', type: 'varchar', isNullable: true },
          { name: 'duration', type: 'int', isNullable: true },
          { name: 'loudness', type: 'float', isNullable: true },
          { name: 'status', type: 'varchar', default: "'processing'" },
          { name: 'errorReason', type: 'text', isNullable: true },
          { name: 'changeNote', type: 'text', isNullable: true },
          { name: 'createdBy', type: 'uuid', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'song_versions',
      new TableForeignKey({
        name: 'FK_song_version_song',
        columnNames: ['songId'],
        referencedTableName: 'songs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'song_versions',
      new TableIndex({ name: 'IDX_song_version_songId', columnNames: ['songId'] }),
    );
    await queryRunner.createIndex(
      'song_versions',
      new TableIndex({ name: 'IDX_song_version_isActive', columnNames: ['isActive'] }),
    );
    await queryRunner.createIndex(
      'song_versions',
      new TableIndex({
        name: 'UQ_song_version_number',
        columnNames: ['songId', 'versionNumber'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('song_versions', 'UQ_song_version_number');
    await queryRunner.dropIndex('song_versions', 'IDX_song_version_isActive');
    await queryRunner.dropIndex('song_versions', 'IDX_song_version_songId');
    await queryRunner.dropForeignKey('song_versions', 'FK_song_version_song');
    await queryRunner.dropTable('song_versions');
  }
}
