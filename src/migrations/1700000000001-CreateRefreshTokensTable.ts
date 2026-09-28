import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateRefreshTokensTable1700000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'refresh_tokens',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'family',
            type: 'varchar',
            isNullable: false,
            comment: 'Token family for rotation tracking',
          },
          {
            name: 'token',
            type: 'varchar',
            isNullable: false,
            comment: 'Hashed refresh token',
          },
          {
            name: 'rotation',
            type: 'integer',
            default: 0,
            comment: 'Number of times this token has been rotated',
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'expires_at',
            type: 'timestamp',
            isNullable: false,
          },
        ],
        indices: [
          {
            name: 'IDX_refresh_tokens_user_id',
            columnNames: ['user_id'],
          },
          {
            name: 'IDX_refresh_tokens_user_family',
            columnNames: ['user_id', 'family'],
            isUnique: true,
          },
          {
            name: 'IDX_refresh_tokens_expires_at',
            columnNames: ['expires_at'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('refresh_tokens');
  }
}
