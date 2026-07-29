import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Song } from './Song';

@Entity('song_play_events')
export class SongPlayEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'songId' })
  song!: Song;

  @Index()
  @Column()
  songId!: string;

  /**
   * Listener who triggered the play, when known (Issue #87). Anonymous streams
   * leave this null and fall back to `listenerKey` for unique-listener counts.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  listenerId?: string | null;

  /**
   * Stable, non-identifying key for anonymous listeners (hashed IP), so unique
   * listener counts don't collapse every anonymous play into one listener.
   */
  @Column({ type: 'varchar', nullable: true })
  listenerKey?: string | null;

  @Index()
  @CreateDateColumn()
  playedAt!: Date;
}
