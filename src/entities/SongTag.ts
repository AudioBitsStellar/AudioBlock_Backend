import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Song } from './Song';
import { Tag } from './Tag';

@Entity('song_tags')
@Unique(['songId', 'tagId'])
export class SongTag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'songId' })
  song!: Song;

  @Column()
  songId!: string;

  @ManyToOne(() => Tag, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tagId' })
  tag!: Tag;

  @Column()
  tagId!: string;
}
