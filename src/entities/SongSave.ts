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
import { Song } from './Song';
import { User } from './User';

/**
 * A listener saving a song to their library (Issue #87).
 *
 * Rows are the data source for the `saves` figure in song and artist
 * statistics; `savedAt` is indexed so time-windowed counts stay cheap.
 */
@Entity('song_saves')
@Unique('UQ_song_save_user_song', ['songId', 'userId'])
export class SongSave {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'songId' })
  song!: Song;

  @Index()
  @Column()
  songId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Index()
  @Column()
  userId!: string;

  @Index()
  @CreateDateColumn()
  savedAt!: Date;
}
