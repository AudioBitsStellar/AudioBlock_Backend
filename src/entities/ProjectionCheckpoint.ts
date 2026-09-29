import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * Tracks how far each read-model projection has consumed the raw
 * `indexed_events` stream (Issue #261). Resetting a checkpoint to 0 and
 * replaying rebuilds the projection from scratch.
 */
@Entity('indexer_projection_checkpoints')
export class ProjectionCheckpoint {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  projection!: string;

  /** Highest `indexed_events.ingestSeq` applied to this projection. */
  @Column({ type: 'bigint', default: 0 })
  lastIngestSeq!: string;

  @Column({ type: 'bigint', default: 0 })
  eventsApplied!: string;

  @Column({ type: 'timestamp', nullable: true })
  lastRebuiltAt!: Date | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
