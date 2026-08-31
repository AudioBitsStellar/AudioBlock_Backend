import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Tracks the indexer's last-processed ledger position per contract + network.
 * Enables resumable event polling and historical backfill (Issues #241, #250, #253).
 */
@Entity('indexer_cursors')
export class IndexerCursor {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  contractId!: string;

  @Column({ type: 'varchar', length: 50 })
  network!: string; // 'mainnet' | 'testnet' | 'futurenet'

  @Column({ type: 'bigint', default: 0 })
  lastProcessedLedger!: numbe
