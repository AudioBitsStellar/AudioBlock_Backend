import { IsEmail } from "class-validator";
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  OneToOne,
  OneToMany,
} from "typeorm";
import { Song } from "./Song";
import { Transaction } from "ethers";
import { TransactionLog } from "./TransactionLog";
import { Album } from "./Album";
import { RoyaltyPayout } from "./RoyaltyPayout";

export enum UserRole {
  LISTENER = "listener",
  ARTIST = "artist",
  ADMIN = "admin",
}

@Entity("users")
@Unique(["walletAddress", "email", "username"])
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true, nullable: true })
  dynamixUserId?: string;

  @Column({ nullable: true })
  profileImage?: string;

  @Column({
    type: "enum",
    enum: UserRole,
    default: UserRole.LISTENER,
  })
  role!: UserRole;

  /** Optional: only set for users who authenticate with a wallet signature. */
  @Column({ nullable: true })
  walletAddress?: string;

  /** Optional: only set for users who authenticate with email + password. */
  @Column({ nullable: true })
  passwordHash?: string;

  @Column({ default: false })
  twoFactorEnabled!: boolean;

  @Column({ default: false })
  emailVerified!: boolean;

  @Column({ nullable: true })
  twoFactorSecret?: string;

  @Column({ nullable: true })
  emailVerificationToken?: string;

  @Column({ nullable: true })
  emailVerificationTokenExpiry?: Date;

  @Column({ nullable: true })
  passwordResetToken?: string;

  @Column({ nullable: true })
  passwordResetTokenExpiry?: Date;

  @Column("simple-json", { nullable: true })
  twoFactorRecoveryCodeHashes?: string[];

  /** Stellar G... public key the artist connected (e.g. via Freighter) for Soroban actions. */
  @Column({ unique: true, nullable: true })
  stellarPublicKey?: string;

  /** artist_id returned by the artist Soroban contract once on-chain setup succeeds. */
  @Column({ nullable: true })
  stellarArtistId?: string;

  /** token_id of the artist's profile NFT, minted by the artist Soroban contract. */
  @Column({ nullable: true })
  stellarArtistTokenId?: string;

  @Column({ unique: true, nullable: true })
  username?: string;

  @Column({ unique: true, nullable: true })
  name?: string;

  @Column({ unique: true, nullable: true })
  @IsEmail()
  email?: string;

  @Column("float", { default: 0 })
  rewardPoints!: number;

  @Column("int", { default: 0 })
  totalStreams!: number;

  @Column("int", { default: 0 })
  totalStreamTime!: number;

  @Column("int", { default: 0 })
  uniqueListeners!: number;

  @Column({ nullable: true })
  bio?: string;

  @Column({ nullable: true })
  pageCover?: string;

  @Column({ nullable: true })
  website?: string;

  @Column({ nullable: true })
  twitterId?: string;

  @Column({ nullable: true })
  twitterUsername?: string;

  @Column({ nullable: true })
  twitterDisplayName?: string;

  @Column({ nullable: true })
  twitterProfileImage?: string;

  @Column({ default: false })
  twitterVerified?: boolean;

  @Column({ nullable: true })
  twitterConnected?: boolean;

  @Column({ nullable: true })
  facebookId?: string;

  @Column({ nullable: true })
  facebookName?: string;

  @Column({ nullable: true })
  facebookEmail?: string;

  @Column({ nullable: true })
  facebookProfileImage?: string;

  @Column({ default: false })
  facebookConnected?: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // One user has many songs
  @OneToMany(() => Song, (song) => song.user)
  songs!: Song[];

  // One user has many albums
  @OneToMany(() => Album, (album) => album.user)
  albums!: Album[];

  // One user has many transaction logs
  @OneToMany(() => TransactionLog, (log) => log.user)
  transactionLogs!: TransactionLog[];

  @OneToMany(() => RoyaltyPayout, (payout) => payout.artist)
  royaltyPayouts!: RoyaltyPayout[];
}
