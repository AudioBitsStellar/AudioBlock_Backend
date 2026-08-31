import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Completion marker for one-time backfill operations (Issue #250).
 * Prevents accidental re-execution of historical data imports.
 */
@Entity('backfill_status')
export class BackfillStatus {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  contractId!: string;

  @Column({ type: 'varchar', length: 50 })
  network!: string;

  @Column({ type: 'boolean', default: false })
  completed!: boolean;

  @Column({ type: 'bigint', nullable: true })
  startLedger!: number | null;

  @Column({ type: 'bigint', nullable: true })
  endLedger!: number | null;

  @Column({ type: 'bigint', default: 0 })
  eventsImported!: number;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
