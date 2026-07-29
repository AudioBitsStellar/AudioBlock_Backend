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
import { Song } from './Song';
import { User } from './User';

export enum CollaboratorRole {
  PRIMARY = 'primary',
  FEATURED = 'featured',
  PRODUCER = 'producer',
  WRITER = 'writer',
  MIXER = 'mixer',
}

export enum CollaboratorStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  REMOVED = 'removed',
}

@Entity('song_collaborators')
@Unique(['songId', 'userId'])
export class SongCollaborator {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Song, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'songId' })
  song!: Song;

  @Column()
  songId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  userId!: string;

  @Column({ type: 'varchar' })
  role!: CollaboratorRole;

  @Column({ type: 'float' })
  royaltyShare!: number;

  @Column({ type: 'varchar', default: CollaboratorStatus.ACTIVE })
  status!: CollaboratorStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
