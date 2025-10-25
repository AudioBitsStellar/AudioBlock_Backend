import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./User";

@Entity("songs") // pluralize for convention
export class Song {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => User, (user) => user.songs, { onDelete: "CASCADE" })
  @JoinColumn({ name: "artistId" }) // foreign key column
  user!: User;

  @Column()
  artistId!: string; 


  @Column()
  coverArtPath!: string; 

  @Column()
  title!: string;

  @Column({ nullable: true })
  description!: string;

  @Column({ nullable: true })
  genre!: string;

  @Column({ nullable: true })
  artistAddress!: string;

  @Column({ nullable: true })
  s3OriginalUrl!: string;

  @Column({ nullable: true })
  hlsMasterUrl!: string;

  @Column({ nullable: true })
  ipfsCid!: string;

  @Column({ nullable: true })
  duration!: number;

  @Column({ nullable: true })
  loudness!: number; // LUFS

  @Column({ default: "processing" })
  status!: "processing" | "ready" | "failed";

  @Column({ nullable: true })
  metadataCid!: string;

  @Column({ type: "json", nullable: true })
  metadata: any;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
