import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateInitialSchema1719619200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'genre',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
            isUnique: true,
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

    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'email',
            type: 'varchar',
            length: '255',
            isNullable: true,
            isUnique: true,
          },
          {
            name: 'username',
            type: 'varchar',
            length: '255',
            isNullable: true,
            isUnique: true,
          },
          {
            name: 'walletAddress',
            type: 'varchar',
            length: '255',
            isNullable: true,
            isUnique: true,
          },
          {
            name: 'passwordHash',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'role',
            type: 'varchar',
            length: '50',
            default: "'listener'",
          },
          {
            name: 'bio',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'website',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'profileImageUrl',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'coverImageUrl',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'stellarPublicKey',
            type: 'varchar',
            length: '255',
            isNullable: true,
            isUnique: true,
          },
          {
            name: 'stellarArtistId',
            type: 'varchar',
            length: '255',
            isNullable: true,
            isUnique: true,
          },
          {
            name: 'stellarArtistTokenId',
            type: 'varchar',
            length: '255',
            isNullable: true,
            isUnique: true,
          },
          {
            name: 'twoFactorEnabled',
            type: 'boolean',
            default: false,
          },
          {
            name: 'twoFactorSecret',
            type: 'varchar',
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

    await queryRunner.createTable(
      new Table({
        name: 'albums',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'artistId',
            type: 'uuid',
          },
          {
            name: 'title',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'coverImageUrl',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'songs',
            type: 'text',
            default: "'{}'",
            comment: 'JSON array of song UUIDs',
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
        foreignKeys: [
          {
            name: 'FK_album_artist',
            columnNames: ['artistId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'songs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'artistId',
            type: 'uuid',
          },
          {
            name: 'title',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'genreId',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'originalUrl',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'hlsMasterUrl',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'coverImageUrl',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '50',
            default: "'processing'",
          },
          {
            name: 'mintStatus',
            type: 'varchar',
            length: '50',
            default: "'not_minted'",
          },
          {
            name: 'metadataCid',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'onChainSongId',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'onChainTokenId',
            type: 'varchar',
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
        foreignKeys: [
          {
            name: 'FK_song_artist',
            columnNames: ['artistId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_song_genre',
            columnNames: ['genreId'],
            referencedTableName: 'genre',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'transactions_logs',
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
            isNullable: true,
          },
          {
            name: 'action',
            type: 'varchar',
            length: '100',
          },
          {
            name: 'details',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'txHash',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        foreignKeys: [
          {
            name: 'FK_transaction_log_user',
            columnNames: ['userId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'royalty_payouts',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'songId',
            type: 'uuid',
          },
          {
            name: 'recipientId',
            type: 'uuid',
          },
          {
            name: 'percentage',
            type: 'numeric',
            precision: 5,
            scale: 2,
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
        foreignKeys: [
          {
            name: 'FK_royalty_payout_song',
            columnNames: ['songId'],
            referencedTableName: 'songs',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'FK_royalty_payout_recipient',
            columnNames: ['recipientId'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex('users',
      new TableIndex({
        name: 'IDX_user_email',
        columnNames: ['email'],
        where: '"email" IS NOT NULL',
      }),
    );

    await queryRunner.createIndex('users',
      new TableIndex({
        name: 'IDX_user_walletAddress',
        columnNames: ['walletAddress'],
        where: '"walletAddress" IS NOT NULL',
      }),
    );

    await queryRunner.createIndex('songs',
      new TableIndex({
        name: 'IDX_song_artistId',
        columnNames: ['artistId'],
      }),
    );

    await queryRunner.createIndex('songs',
      new TableIndex({
        name: 'IDX_song_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex('albums',
      new TableIndex({
        name: 'IDX_album_artistId',
        columnNames: ['artistId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('royalty_payouts');
    await queryRunner.dropTable('transactions_logs');
    await queryRunner.dropTable('songs');
    await queryRunner.dropTable('albums');
    await queryRunner.dropTable('users');
    await queryRunner.dropTable('genre');
  }
}
