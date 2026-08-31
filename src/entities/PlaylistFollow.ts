import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from './User';
import { Playlist } from './Playlist';

/**
 * A listener following a playlist to receive updates (Issue #408).
 *
 * Mirrors the `UserFollow` relation: a follower subscribes to a playlist so
 * that playlist activity can surface in their feed. The `(userId, playlistId)`
 * unique constraint prevents duplicate follows from the same listener.
 */
@Entity('playlist_follows')
@Unique(['userId', 'playlistId'])
export class PlaylistFollow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column()
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Index()
  @Column()
  playlistId!: string;

  @ManyToOne(() => Playlist, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playlistId' })
  playlist!: Playlist;

  @CreateDateColumn()
  createdAt!: Date;
}
