import logger from '../config/logger';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  healthCheckIntervalMs: number;
}

export interface CircuitBreakerStatus {
  state: CircuitState;
  failures: number;
  lastFailure: Date | null;
  openedAt: Date | null;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailure: Date | null = null;
  private openedAt: Date | null = null;
  private resetTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private healthCheckFn: () => Promise<boolean>;

  public readonly config: CircuitBreakerConfig;

  constructor(
    healthCheckFn: () => Promise<boolean>,
    config?: Partial<CircuitBreakerConfig>,
  ) {
    this.healthCheckFn = healthCheckFn;
    this.config = {
      failureThreshold: config?.failureThreshold ?? 3,
      resetTimeoutMs: config?.resetTimeoutMs ?? 30000,
      healthCheckIntervalMs: config?.healthCheckIntervalMs ?? 30000,
    };
  }

  get currentState(): CircuitState {
    return this.state;
  }

  isOpen(): boolean {
    return this.state === 'OPEN';
  }

  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failures: this.failureCount,
      lastFailure: this.lastFailure,
      openedAt: this.openedAt,
    };
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.lastFailure = null;

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('CLOSED');
    }
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailure = new Date();

    logger.warn(
      { failures: this.failureCount, threshold: this.config.failureThreshold },
      `Circuit breaker failure recorded (${this.failureCount}/${this.config.failureThreshold})`,
    );

    if (this.failureCount >= this.config.failureThreshold) {
      this.transitionTo('OPEN');
      this.openedAt = new Date();
      logger.error(
        `Circuit breaker opened after ${this.failureCount} consecutive failures`,
      );

      this.resetTimer = setTimeout(() => {
        this.transitionTo('HALF_OPEN');
        logger.info('Circuit breaker transitioning to HALF_OPEN — testing connection');
      }, this.config.resetTimeoutMs);

      if (this.resetTimer.unref) {
        this.resetTimer.unref();
      }
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      throw new CircuitBreakerOpenError(
        'Circuit breaker is open — please try again later',
      );
    }

    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') {
        this.recordSuccess();
      }
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  startHealthChecks(): void {
    if (this.healthTimer) return;

    this.healthTimer = setInterval(async () => {
      try {
        const healthy = await this.healthCheckFn();
        if (healthy) {
          if (this.state === 'HALF_OPEN') {
            this.recordSuccess();
          }
        } else {
          if (this.state !== 'OPEN') {
            this.recordFailure();
          }
        }
      } catch {
        if (this.state !== 'OPEN') {
          this.recordFailure();
        }
      }
    }, this.config.healthCheckIntervalMs);

    if (this.healthTimer.unref) {
      this.healthTimer.unref();
    }

    logger.info(
      { intervalMs: this.config.healthCheckIntervalMs },
      'Circuit breaker health checks started',
    );
  }

  stopHealthChecks(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  destroy(): void {
    this.stopHealthChecks();
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    logger.info(
      { oldState, newState },
      `Circuit breaker state changed: ${oldState} → ${newState}`,
    );
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}
