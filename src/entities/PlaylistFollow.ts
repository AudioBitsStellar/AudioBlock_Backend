import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from "typeorm";
import { User } from "./User";
import { Playlist } from "./Playlist";

/**
 * Playlist follow/subscribe (Issue #408).
 *
 * Listeners can follow a playlist to receive notifications when new songs
 * are added. One follow per user per playlist.
 */
@Entity("playlist_follows")
@Unique("UQ_playlist_follow_user_playlist", ["userId", "playlistId"])
@Index(["playlistId"])
@Index(["userId"])
export class PlaylistFollow {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "uuid" })
  playlistId!: string;

  @ManyToOne(() => Playlist, { onDelete: "CASCADE" })
  @JoinColumn({ name: "playlistId" })
  playlist!: Playlist;

  @CreateDateColumn()
  createdAt!: Date;
}
