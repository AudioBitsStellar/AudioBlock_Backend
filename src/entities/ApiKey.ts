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

@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  name!: string;

  @Column()
  keyHash!: string;

  @Column()
  keyPrefix!: string;

  @Column('simple-array', { default: '' })
  permissions!: string[];

  @Column('simple-array', { default: '' })
  scopes!: string[];

  @Column({ default: false })
  isRevoked!: boolean;

  @Column({ nullable: true, type: 'timestamp' })
  lastUsedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
