import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Tracks the indexer's last-processed ledger position per contract + network.
 * Enables resumable event polling and historical backfill (Issues #241, #250, #253).
 */
@Entity('indexer_cursors')
@Index('IDX_indexer_cursors_contract_network', ['contractId', 'network'], { unique: true })
export class IndexerCursor {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  contractId!: string;

  @Column({ type: 'varchar', length: 50 })
  network!: string; // 'mainnet' | 'testnet' | 'futurenet'

  @Column({ type: 'bigint', default: 0 })
  lastProcessedLedger!: number;

  @Column({ type: 'bigint', default: 0 })
  eventsProcessed!: number;

  @Column({ type: 'bigint', default: 0 })
  errorCount!: number;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastErrorAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
