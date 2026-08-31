import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('indexed_events')
@Unique('UQ_indexed_events_dedup', ['network', 'contractId', 'ledger', 'eventId'])
@Index('IDX_indexed_events_network_contract_ledger', ['network', 'contractId', 'ledger'])
@Index('IDX_indexed_events_txHash', ['txHash'])
@Index('IDX_indexed_events_contractType_createdAt', ['contractType', 'createdAt'])
@Index('IDX_indexed_events_eventType_createdAt', ['eventType', 'createdAt'])
@Index('IDX_indexed_events_address_createdAt', ['address', 'createdAt'])
export class IndexedEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50, default: 'stellar-testnet' })
  network!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  contractId?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  contractType?: string;

  @Column({ type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  eventId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  txHash?: string;

  @Column({ type: 'bigint', nullable: true })
  ledger?: number;

  @Column({ type: 'jsonb', nullable: true })
  payload?: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  data?: Record<string, unknown>;

  @CreateDateColumn({ name: 'indexed_at' })
  indexedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
