import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './User';

export enum ReleaseType {
  ALBUM = 'album',
  EP = 'ep',
  SINGLE = 'single',
}

@Entity('releases')
export class Release {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  title!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'artistId' })
  artist!: User;

  @Column()
  artistId!: string;

  @Column({ type: 'timestamp' })
  releaseDate!: Date;

  @Column({ type: 'varchar', default: ReleaseType.ALBUM })
  type!: ReleaseType;

  @Column({ nullable: true })
  coverArt?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
