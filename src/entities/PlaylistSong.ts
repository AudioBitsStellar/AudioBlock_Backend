import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Playlist } from './Playlist';
import { Song } from './Song';

@Entity('playlist_songs')
@Unique(['playlistId', 'songId'])
export class PlaylistSong {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  playlistId!: string;

  @ManyToOne(() => Playlist, (playlist) => playlist.songs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playlistId' })
  playlist!: Playlist;

  @Column()
  songId!: string;

  @ManyToOne(() => Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'songId' })
  song!: Song;

  @Column({ type: 'int', default: 0 })
  position!: number;

  @CreateDateColumn()
  addedAt!: Date;
}
