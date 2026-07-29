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

  @Index()
  @CreateDateColumn()
  playedAt!: Date;
}
