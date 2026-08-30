import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "./User";
import { SubscriptionTier } from "./Subscription";

@Entity("fan_perks")
@Index(["artistId"])
@Index(["tier"])
export class FanPerk {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  artistId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "artistId" })
  artist!: User;

  @Column({ type: "enum", enum: SubscriptionTier })
  tier!: SubscriptionTier;

  @Column({ type: "varchar", length: 150 })
  name!: string;

  @Column({ type: "text", nullable: true })
  description?: string | null;

  @Column({ type: "varchar", length: 50, default: "custom" })
  perkType!: string;

  @Column({ type: "varchar", length: 500, nullable: true })
  resourceUrl?: string | null;

  @Column({ type: "int", nullable: true })
  discountPercent?: number | null;

  @Column({ default: false })
  hidden!: boolean;

  @Column({ type: "int", default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
