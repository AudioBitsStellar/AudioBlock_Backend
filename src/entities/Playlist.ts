import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from './User';
import { PlaylistSong } from './PlaylistSong';

@Entity('playlists')
export class Playlist {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  @ManyToOne(() => User, (user) => (user as any).playlists, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description!: string;

  @Column({ default: true })
  isPublic!: boolean;

  @Column({ nullable: true })
  coverImageUrl!: string;

  @OneToMany(() => PlaylistSong, (ps) => ps.playlist, { cascade: true })
  songs!: PlaylistSong[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
