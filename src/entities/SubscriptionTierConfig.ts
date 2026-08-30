import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { SubscriptionTier } from './Subscription';

/**
 * Configurable tier definitions for subscription plans (Issue #413).
 *
 * Each row stores the price, feature set, and limits for one tier. The
 * application reads this table at startup and uses it to validate upgrade
 * requests, gate features, and render the pricing page — instead of hard-
 * coding tier metadata in source.
 */
@Entity('subscription_tier_configs')
@Unique(['tier'])
export class SubscriptionTierConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: SubscriptionTier, unique: true })
  tier!: SubscriptionTier;

  /** Human-readable display name shown on the pricing page. */
  @Column({ type: 'varchar', length: 100 })
  displayName!: string;

  /** Monthly price in USD cents (0 = free). */
  @Column({ type: 'int', default: 0 })
  monthlyPriceCents!: number;

  /** Annual price in USD cents; null means annual billing is not offered. */
  @Column({ type: 'int', nullable: true })
  annualPriceCents?: number | null;

  /** JSON-serialised list of feature keys this tier unlocks. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  features!: string[];

  /** Maximum uploads per month; null = unlimited. */
  @Column({ type: 'int', nullable: true })
  maxUploadsPerMonth?: number | null;

  /** Maximum storage in bytes; null = unlimited. */
  @Column({ type: 'bigint', nullable: true })
  maxStorageBytes?: number | null;

  /** If true, this tier is not currently available for new subscriptions. */
  @Column({ default: false })
  hidden!: boolean;

  /** Display order on the pricing page. */
  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
