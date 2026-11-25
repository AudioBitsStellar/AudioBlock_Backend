import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Lifecycle state of a marketplace relay the backend built and submitted.
 *
 * `pending`  -> the unsigned tx was prepared and the intent recorded; the
 *               signed tx has not been confirmed by the network yet.
 * `active`   -> the seller's `list_nft`/`create_auction` landed on-chain.
 * `sold`     -> a `buy_nft` for the same token was confirmed.
 * `cancelled`-> the listing was cancelled on-chain (seller called the contract
 *               directly, so it is only observable from indexed events).
 * `expired`  -> an auction reached its end time without being settled.
 * `failed`   -> the relay never confirmed, or its submission was rejected.
 */
export type MarketplaceListingStatus =
  'pending' | 'active' | 'sold' | 'cancelled' | 'expired' | 'failed';

/** How the token was offered, which decides whether it can expire at all. */
export type MarketplaceListingKind = 'fixed_price' | 'auction';

/**
 * Statuses no later transition can leave. The lifecycle sweep only reads rows
 * outside this set, and the retention step only deletes rows inside it.
 */
export const MARKETPLACE_TERMINAL_STATUSES: readonly MarketplaceListingStatus[] = [
  'sold',
  'cancelled',
  'expired',
  'failed',
] as const;

/**
 * One relayed marketplace intent, with the status the chain left it in.
 *
 * The marketplace relay is sign-locally: the backend builds the invocation, the
 * wallet signs it, and the backend submits it. Until this table existed, the
 * only record of a listing was the tx hash returned to the caller — so a listing
 * whose transaction never landed, and an auction whose end time passed with no
 * bid, were both invisible. Both fields below that the sweep needs (`endsAt`,
 * `txHash`) are taken from the signed transaction itself rather than from the
 * request body, so a row describes what was actually put on-chain.
 */
@Entity('marketplace_listings')
@Index('IDX_marketplace_listings_status_ends_at', ['status', 'endsAt'])
@Index('IDX_marketplace_listings_token_id', ['tokenId'])
export class MarketplaceListing {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Soroban `u64` token id, kept as a string so large ids lose no precision. */
  @Column({ type: 'bigint' })
  tokenId!: string;

  @Column({ type: 'varchar' })
  kind!: MarketplaceListingKind;

  @Column({ type: 'varchar' })
  sellerPublicKey!: string;

  /** Ask price (fixed price) or reserve (auction), in stroops. */
  @Column({ type: 'bigint', nullable: true })
  priceStroops?: string;

  @Column({ type: 'varchar' })
  status!: MarketplaceListingStatus;

  /** Hash of the confirmed submission; null while still `pending`. */
  @Column({ type: 'varchar', nullable: true })
  txHash?: string;

  /** Auction close time. Only set for `auction` rows — fixed-price listings never expire. */
  @Column({ type: 'timestamp', nullable: true })
  endsAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  confirmedAt?: Date;

  @Column({ type: 'text', nullable: true })
  failureReason?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
