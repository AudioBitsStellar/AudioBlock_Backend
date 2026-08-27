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
import { PlaylistCollaborator } from './PlaylistCollaborator';

/** Supported smart-playlist rule criteria (Issue #407). */
export interface PlaylistRule {
  tags?: string[];
  genres?: string[];
  /** Only songs saved (added to the platform) within the last N days. */
  savedWithinDays?: number;
}

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

  /** True when this playlist is a smart/rule-based playlist (Issue #407). */
  @Column({ default: false })
  isRuleBased!: boolean;

  /** Filter criteria for rule-based playlists; resolved at read time. */
  @Column({ type: 'json', nullable: true })
  rule!: PlaylistRule | null;

  @OneToMany(() => PlaylistSong, (ps) => ps.playlist, { cascade: true })
  songs!: PlaylistSong[];

  @OneToMany(() => PlaylistCollaborator, (pc) => pc.playlist, { cascade: true })
  collaborators!: PlaylistCollaborator[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
