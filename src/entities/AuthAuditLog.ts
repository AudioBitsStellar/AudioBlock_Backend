import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum AuthEventType {
  LOGIN_SUCCESS = 'login_success',
  LOGIN_FAILED = 'login_failed',
  LOGOUT = 'logout',
  TOKEN_REFRESH = 'token_refresh',
  TOKEN_REFRESH_FAILED = 'token_refresh_failed',
  PASSWORD_RESET_REQUESTED = 'password_reset_requested',
  PASSWORD_RESET_COMPLETED = 'password_reset_completed',
  TWO_FACTOR_ENABLED = 'two_factor_enabled',
  TWO_FACTOR_DISABLED = 'two_factor_disabled',
  ACCOUNT_MERGED = 'account_merged',
  PRIVY_LOGIN_SUCCESS = 'privy_login_success',
  PRIVY_LOGIN_FAILED = 'privy_login_failed',
  PRIVY_LOGOUT = 'privy_logout',
  PRIVY_TOKEN_REFRESH = 'privy_token_refresh',
}

@Entity('auth_audit_logs')
@Index(['userId', 'createdAt'])
@Index(['eventType', 'createdAt'])
@Index(['ipAddress', 'createdAt'])
export class AuthAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ nullable: true })
  @Index()
  userId?: string;

  @Column({
    type: 'simple-enum',
    enum: AuthEventType,
  })
  eventType!: AuthEventType;

  @Column({ nullable: true })
  ipAddress?: string;

  @Column({ nullable: true })
  userAgent?: string;

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: true })
  privyUserId?: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, any>;

  @Column({ default: true })
  success!: boolean;

  @Column({ nullable: true })
  failureReason?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
