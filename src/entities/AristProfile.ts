import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  OneToOne,
} from "typeorm";
import { User } from "./User";
import { JoinColumn } from "typeorm";


@Entity("artist_profiles")
@Unique(["artist_name", "twitter_handle", "distro_kid"])
export class ArtistProfile {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @OneToOne(() => User, (user) => user.artistProfile, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" }) // defines the foreign key
  user!: User;

  @Column({ unique: true, nullable: false })
  artist_name!: string;

  @Column({ unique: true, nullable: false })
  twitter_handle!: string;

  @Column({ unique: true, nullable: false })
  distro_kid!: string;

  @Column({ nullable: true })
  profileImage?: string;

  @Column({ nullable: true })
  bio?: string;

  @Column({ nullable: true })
  pageCover?: string;

  @Column({ nullable: true, default: false })
  twitter_verified?: boolean;

  @Column({ nullable: true, default: false })
  distro_kid_verified?: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
