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
import { User } from './User';

@Entity('user_follows')
@Unique(['followerId', 'followingId'])
export class UserFollow {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column()
  followerId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'followerId' })
  follower!: User;

  @Index()
  @Column()
  followingId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'followingId' })
  following!: User;

  @CreateDateColumn()
  createdAt!: Date;
}
