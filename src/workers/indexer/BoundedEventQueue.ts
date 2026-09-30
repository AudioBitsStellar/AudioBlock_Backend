/**
 * Bounded in-memory queue between event fetch and DB write.
 *
 * When Postgres write throughput cannot keep up with a burst of on-chain
 * events, the queue fills up and producers pause (await `enqueue`) instead
 * of piling up unbounded memory. Consumers drain via `dequeueBatch`.
 */
export class BoundedEventQueue<T> {
  private items: T[] = [];
  private waiters: Array<() => void> = [];

  constructor(private readonly maxSize: number) {
    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      throw new Error('BoundedEventQueue maxSize must be a positive integer');
    }
  }

  get capacity(): number {
    return this.maxSize;
  }

  get size(): number {
    return this.items.length;
  }

  get isFull(): boolean {
    return this.items.length >= this.maxSize;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** Non-blocking enqueue. Returns false when the queue is full. */
  tryEnqueue(item: T): boolean {
    if (this.isFull) return false;
    this.items.push(item);
    return true;
  }

  /**
   * Enqueue, waiting while the queue is full. This is the backpressure
   * mechanism: fetch pauses here until the DB writer drains space.
   */
  async enqueue(item: T): Promise<void> {
    while (this.isFull) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.items.push(item);
  }

  /** Remove up to `batchSize` items (FIFO). Returns [] when empty. */
  dequeueBatch(batchSize: number): T[] {
    if (batchSize <= 0 || this.items.length === 0) return [];
    const batch = this.items.splice(0, Math.min(batchSize, this.items.length));
    this.notifySpaceAvailable();
    return batch;
  }

  /** Drain everything currently buffered. */
  drain(): T[] {
    return this.dequeueBatch(this.items.length);
  }

  clear(): void {
    this.items = [];
    this.notifySpaceAvailable();
  }

  private notifySpaceAvailable(): void {
    const waiters = this.waiters.splice(0);
    for (const w of waiters) w();
  }
}
