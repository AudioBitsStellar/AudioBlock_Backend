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
import { Song } from './Song';

/** Collection a save falls into when the caller does not name one. */
export const DEFAULT_SAVE_COLLECTION = 'Favorites';

/** Maximum length of a user-supplied collection name. */
export const SAVE_COLLECTION_MAX_LENGTH = 100;

/**
 * A song saved (bookmarked) to a user's library (Issue #91).
 *
 * The unique constraint spans the collection name so the same song may sit in
 * two collections but never twice in one — this is what makes saving idempotent.
 */
@Entity('user_saves')
@Unique('UQ_user_saves_user_song_collection', ['userId', 'songId', 'collection'])
@Index(['userId'])
@Index(['songId'])
export class UserSave {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'uuid' })
  songId!: string;

  @ManyToOne(() => Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'songId' })
  song!: Song;

  /** Playlist-like grouping, e.g. "Favorites" or "Later". */
  @Column({ length: SAVE_COLLECTION_MAX_LENGTH, default: DEFAULT_SAVE_COLLECTION })
  collection!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
