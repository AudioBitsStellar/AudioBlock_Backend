import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './User';

export enum RoyaltyPayoutStatus {
  PENDING = 'pending',
  RECONCILED = 'reconciled',
  DISCREPANCY = 'discrepancy',
}

export interface RoyaltySplit {
  recipientPublicKey: string;
  shareBps: number;
  expectedAmount: string;
  actualAmount?: string;
}

@Entity('royalty_payouts')
export class RoyaltyPayout {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  saleEventId!: string;

  @Column({ nullable: true })
  saleTxHash?: string;

  @Column({ nullable: true })
  onChainEventId?: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  chainNetwork?: 'testnet' | 'mainnet' | null;

  @Column({ nullable: true })
  songId?: string;

  @Column({ nullable: true })
  tokenId?: string;

  @Column({ nullable: true })
  buyerPublicKey?: string;

  @Column({ nullable: true })
  sellerPublicKey?: string;

  @Column({ default: 'stroops' })
  currency!: string;

  @Column({ type: 'bigint' })
  grossAmount!: string;

  @Column('simple-json')
  expectedSplits!: RoyaltySplit[];

  @Column({
    type: 'simple-enum',
    enum: RoyaltyPayoutStatus,
    default: RoyaltyPayoutStatus.PENDING,
  })
  status!: RoyaltyPayoutStatus;

  /**
   * True while the payout is held because the artist is not yet verified
   * (#979). Released by {@link PayoutEligibilityService.releaseHeldPayouts}
   * once the artist's verification is approved.
   */
  @Column({ default: false })
  heldUntilVerified!: boolean;

  @Column({ nullable: true })
  discrepancyReason?: string;

  @Column({ type: 'timestamp', nullable: true })
  reconciledAt?: Date;

  @ManyToOne(() => User, (user) => user.royaltyPayouts, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'artist_id' })
  artist?: User;

  @Column({ nullable: true })
  artist_id?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
