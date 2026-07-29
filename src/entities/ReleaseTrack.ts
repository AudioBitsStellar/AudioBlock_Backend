import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Release } from './Release';
import { Song } from './Song';

@Entity('release_tracks')
@Unique(['releaseId', 'songId'])
export class ReleaseTrack {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Release, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'releaseId' })
  release!: Release;

  @Column()
  releaseId!: string;

  @ManyToOne(() => Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'songId' })
  song!: Song;

  @Column()
  songId!: string;

  @Column({ type: 'int' })
  trackNumber!: number;
}
