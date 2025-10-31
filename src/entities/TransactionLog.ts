import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./User";

@Entity("transactions_logs") // pluralize for convention
export class TransactionLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => User, (user) => user.songs, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" }) // foreign key column
  user!: User;

  @Column()
  user_id!: string; 

  @Column()
  txHash!: string; 

  @Column()
  action!: string;

  @Column({ nullable: true })
  description?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
