import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * Denormalized per-type event counts, derived from `indexed_events` by the
 * `onchain_event_counts` projection (Issue #261). Never written by ingestion;
 * safe to truncate and rebuild via `npm run cli:project -- --rebuild`.
 */
@Entity('onchain_event_counts')
export class OnChainEventCount {
  @PrimaryColumn({ type: 'varchar', length: 50 })
  network!: string;

  @PrimaryColumn({ type: 'varchar', length: 100 })
  contractType!: string;

  @PrimaryColumn({ type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ type: 'bigint', default: 0 })
  count!: string;

  @UpdateDateColumn()
  updatedAt!: Date;
}
