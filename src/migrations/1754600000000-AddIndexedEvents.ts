import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddIndexedEvents1754600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'indexed_events',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'network',
            type: 'varchar',
            length: '50',
            default: "'stellar-testnet'",
          },
          { name: 'contractId', type: 'varchar', length: '100', isNullable: true },
          { name: 'contractType', type: 'varchar', length: '100', isNullable: true },
          { name: 'eventType', type: 'varchar', length: '100' },
          { name: 'eventId', type: 'varchar', length: '255', isNullable: true },
          { name: 'address', type: 'varchar', length: '255', isNullable: true },
          { name: 'txHash', type: 'varchar', length: '255', isNullable: true },
          { name: 'ledger', type: 'bigint', isNullable: true },
          { name: 'payload', type: 'jsonb', isNullable: true },
          { name: 'data', type: 'jsonb', isNullable: true },
          { name: 'indexed_at', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'createdAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
          { name: 'updatedAt', type: 'timestamp', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'indexed_events',
      new TableIndex({
        name: 'IDX_indexed_events_network_contract_ledger',
        columnNames: ['network', 'contractId', 'ledger'],
      }),
    );
    await queryRunner.createIndex(
      'indexed_events',
      new TableIndex({ name: 'IDX_indexed_events_txHash', columnNames: ['txHash'] }),
    );
    await queryRunner.createIndex(
      'indexed_events',
      new TableIndex({
        name: 'IDX_indexed_events_contractType_createdAt',
        columnNames: ['contractType', 'createdAt'],
      }),
    );
    await queryRunner.createIndex(
      'indexed_events',
      new TableIndex({
        name: 'IDX_indexed_events_eventType_createdAt',
        columnNames: ['eventType', 'createdAt'],
      }),
    );
    await queryRunner.createIndex(
      'indexed_events',
      new TableIndex({
        name: 'IDX_indexed_events_address_createdAt',
        columnNames: ['address', 'createdAt'],
      }),
    );
    await queryRunner.createIndex(
      'indexed_events',
      new TableIndex({
        name: 'UQ_indexed_events_dedup',
        columnNames: ['network', 'contractId', 'ledger', 'eventId'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('indexed_events');
  }
}
