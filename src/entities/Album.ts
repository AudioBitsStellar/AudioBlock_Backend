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

@Entity("albums") // pluralize for convention
export class Album {
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
  genre?: string;

  @Column({ nullable: false, type: "simple-array" })
  songs! : string[]; // array of song IDs

  @Column({ nullable: true })
  artistAddress!: string;

  @Column({ nullable: true })
  metadataCid!: string;

  @Column({ type: "json", nullable: true })
  metadata: any;

  @Column({ nullable: true })
  composers?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
