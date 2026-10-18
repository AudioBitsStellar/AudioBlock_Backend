import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { WebhookSubscription } from './WebhookSubscription';

export enum WebhookDeliveryStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

/**
 * Audit and delivery log for outbound webhook attempts (Issue #824).
 * Records response status codes, latency, errors, and stores payload for redelivery.
 */
@Entity('webhook_deliveries')
@Index('IDX_webhook_deliveries_subscriptionId', ['subscriptionId'])
@Index('IDX_webhook_deliveries_createdAt', ['createdAt'])
@Index('IDX_webhook_deliveries_eventId', ['eventId'])
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  subscriptionId!: string;

  @ManyToOne(() => WebhookSubscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscriptionId' })
  subscription!: WebhookSubscription;

  @Column()
  eventId!: string;

  @Column()
  eventType!: string;

  @Column({ type: 'int', default: 1 })
  attempt!: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: WebhookDeliveryStatus.PENDING,
  })
  status!: WebhookDeliveryStatus;

  @Column({ type: 'int', nullable: true })
  responseStatus!: number | null;

  @Column({ type: 'int', nullable: true })
  durationMs!: number | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'simple-json', nullable: true })
  payload!: Record<string, any> | null;

  @CreateDateColumn()
  createdAt!: Date;
}
