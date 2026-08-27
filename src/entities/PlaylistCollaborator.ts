import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Playlist } from './Playlist';
import { User } from './User';

export enum PlaylistCollaboratorRole {
  EDITOR = 'editor',
  VIEWER = 'viewer',
}

/**
 * A user invited to a shared playlist (Issue #406).
 *
 * Mirrors the SongCollaborator pattern: a row exists only once a user has been
 * invited, and its `role` controls their permission on the playlist.
 * `EDITOR` collaborators can add/remove/reorder songs; `VIEWER` collaborators
 * can only read it. The playlist owner always retains full control and is not
 * represented here.
 */
@Entity('playlist_collaborators')
@Unique(['playlistId', 'userId'])
export class PlaylistCollaborator {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Playlist, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playlistId' })
  playlist!: Playlist;

  @Column()
  playlistId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  userId!: string;

  @Column({ type: 'varchar', default: PlaylistCollaboratorRole.EDITOR })
  role!: PlaylistCollaboratorRole;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
