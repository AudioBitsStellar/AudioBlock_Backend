/**
 * Background job queue with priority + dead-letter queue (Issue #132)
 * ───────────────────────────────────────────────────────────────────
 * A Redis-backed job queue abstraction for background work (transcoding,
 * pinning, reconciliation, search indexing, …). It provides:
 *
 *   • Three priority levels — `critical`, `normal`, `low` — drained in order.
 *   • Per-job status tracking — `pending`, `processing`, `completed`, `failed`.
 *   • Configurable retries with exponential backoff.
 *   • A dead-letter queue (DLQ) that permanently stores jobs which exhausted
 *     all retries, preserving their metadata for debugging.
 *   • Queue-depth stats for monitoring / the admin jobs endpoint.
 *
 * Storage layout (Redis):
 *   jobs:queue:<priority>  → List<jobId>   (FIFO per priority; LPUSH + BRPOP)
 *   jobs:record:<jobId>    → JSON Job       (full job metadata)
 *   jobs:dlq               → List<jobId>    (dead-lettered jobs)
 *   jobs:stats             → Hash           (counts per status)
 *
 * Configuration (env vars):
 *   JOB_MAX_ATTEMPTS        – default max attempts per job   (default 3)
 *   JOB_BACKOFF_BASE_MS     – base backoff delay             (default 2000)
 *   JOB_BACKOFF_MAX_MS      – backoff ceiling                (default 30000)
 *   JOB_COMPLETED_TTL_S     – how long to keep finished jobs (default 3600)
 *   JOB_QUEUE_WARN_THRESHOLD– warn when queued jobs exceed   (default 100)
 */
import redis from "../config/redis";
import logger from "../config/logger";
import { randomUUID } from "crypto";

export type JobPriority = "critical" | "normal" | "low";
export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface Job<T = any> {
  id: string;
  type: string;
  payload: T;
  priority: JobPriority;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface EnqueueOptions {
  priority?: JobPriority;
  maxAttempts?: number;
}

const PRIORITIES: JobPriority[] = ["critical", "normal", "low"];
const QUEUE_KEY = (p: JobPriority) => `jobs:queue:${p}`;
const RECORD_KEY = (id: string) => `jobs:record:${id}`;
const DLQ_KEY = "jobs:dlq";
const STATS_KEY = "jobs:stats";

const MAX_ATTEMPTS = parseInt(process.env.JOB_MAX_ATTEMPTS || "3", 10);
const BACKOFF_BASE_MS = parseInt(process.env.JOB_BACKOFF_BASE_MS || "2000", 10);
const BACKOFF_MAX_MS = parseInt(process.env.JOB_BACKOFF_MAX_MS || "30000", 10);
const COMPLETED_TTL_S = parseInt(process.env.JOB_COMPLETED_TTL_S || "3600", 10);
const QUEUE_WARN_THRESHOLD = parseInt(
  process.env.JOB_QUEUE_WARN_THRESHOLD || "100",
  10
);

export interface JobQueueStats {
  queues: Record<JobPriority, number>;
  totalQueued: number;
  dlq: number;
  byStatus: Record<JobStatus, number>;
}

export class JobQueueService {
  /** Exponential backoff delay for a given (1-based) attempt, capped. */
  static backoffDelay(attempt: number): number {
    return Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt - 1), BACKOFF_MAX_MS);
  }

  private static async saveRecord(job: Job, ttlSeconds?: number): Promise<void> {
    const key = RECORD_KEY(job.id);
    if (ttlSeconds && ttlSeconds > 0) {
      await redis.set(key, JSON.stringify(job), "EX", ttlSeconds);
    } else {
      await redis.set(key, JSON.stringify(job));
    }
  }

  /** Move a job to a new status, keeping the per-status counters in sync. */
  private static async setStatus(job: Job, status: JobStatus): Promise<void> {
    if (job.status !== status) {
      await redis
        .pipeline()
        .hincrby(STATS_KEY, job.status, -1)
        .hincrby(STATS_KEY, status, 1)
        .exec();
    }
    job.status = status;
    job.updatedAt = new Date().toISOString();
  }

  /**
   * Enqueue a new job. Returns the created job record. The job is added to the
   * tail of its priority queue and marked `pending`.
   */
  static async enqueue<T = any>(
    type: string,
    payload: T,
    options: EnqueueOptions = {}
  ): Promise<Job<T>> {
    const now = new Date().toISOString();
    const job: Job<T> = {
      id: randomUUID(),
      type,
      payload,
      priority: options.priority ?? "normal",
      status: "pending",
      attempts: 0,
      maxAttempts: options.maxAttempts ?? MAX_ATTEMPTS,
      createdAt: now,
      updatedAt: now,
    };

    await this.saveRecord(job);
    await redis.hincrby(STATS_KEY, "pending", 1);
    await redis.lpush(QUEUE_KEY(job.priority), job.id);

    logger.debug({ jobId: job.id, type, priority: job.priority }, "Job enqueued");
    return job;
  }

  /** Fetch a job record by id. */
  static async getJob(jobId: string): Promise<Job | null> {
    const raw = await redis.get(RECORD_KEY(jobId));
    return raw ? (JSON.parse(raw) as Job) : null;
  }

  /**
   * Blocking reserve of the next job across all priority queues (critical →
   * normal → low). Uses BRPOP on a caller-supplied (dedicated, blocking)
   * connection. Returns null on timeout. The reserved job is marked
   * `processing`.
   */
  static async reserve(
    blockingClient: typeof redis,
    timeoutSeconds = 5
  ): Promise<Job | null> {
    const keys = PRIORITIES.map(QUEUE_KEY);
    const popped = await blockingClient.brpop(...keys, timeoutSeconds);
    if (!popped) return null;

    const jobId = popped[1];
    const job = await this.getJob(jobId);
    if (!job) return null;

    job.attempts += 1;
    await this.setStatus(job, "processing");
    await this.saveRecord(job);
    return job;
  }

  /** Mark a job completed. The record is kept briefly (TTL) for inspection. */
  static async complete(job: Job): Promise<void> {
    await this.setStatus(job, "completed");
    await this.saveRecord(job, COMPLETED_TTL_S);
    logger.debug({ jobId: job.id, type: job.type }, "Job completed");
  }

  /**
   * Record a failure. If attempts remain the job is re-queued after an
   * exponential backoff; otherwise it is dead-lettered. Returns whether the
   * job will be retried.
   */
  static async fail(job: Job, error: unknown): Promise<boolean> {
    job.lastError = error instanceof Error ? error.message : String(error);

    if (job.attempts < job.maxAttempts) {
      const delay = this.backoffDelay(job.attempts);
      await this.setStatus(job, "pending");
      await this.saveRecord(job);

      logger.warn(
        { jobId: job.id, type: job.type, attempt: job.attempts, delay },
        `Job failed, retrying in ${delay}ms`
      );

      // Re-queue after the backoff delay. Keeps priority (critical retries stay
      // ahead of low-priority new work).
      setTimeout(() => {
        redis
          .lpush(QUEUE_KEY(job.priority), job.id)
          .catch((err) =>
            logger.error({ jobId: job.id, err }, "Failed to re-queue job")
          );
      }, delay);

      return true;
    }

    await this.moveToDLQ(job);
    return false;
  }

  /** Permanently dead-letter a job, preserving its metadata for debugging. */
  static async moveToDLQ(job: Job): Promise<void> {
    await this.setStatus(job, "failed");
    await this.saveRecord(job); // no TTL — keep DLQ records for investigation
    await redis.lpush(DLQ_KEY, job.id);
    logger.error(
      { jobId: job.id, type: job.type, attempts: job.attempts, error: job.lastError },
      `Job moved to dead-letter queue after ${job.attempts} attempts`
    );
  }

  /** Aggregate queue statistics for monitoring / the admin endpoint. */
  static async getStats(): Promise<JobQueueStats> {
    const pipeline = redis.pipeline();
    PRIORITIES.forEach((p) => pipeline.llen(QUEUE_KEY(p)));
    pipeline.llen(DLQ_KEY);
    pipeline.hgetall(STATS_KEY);
    const res = (await pipeline.exec()) ?? [];

    const queues = {} as Record<JobPriority, number>;
    PRIORITIES.forEach((p, i) => {
      queues[p] = Number((res[i]?.[1] as number) ?? 0);
    });
    const dlq = Number((res[PRIORITIES.length]?.[1] as number) ?? 0);
    const statsHash = (res[PRIORITIES.length + 1]?.[1] as Record<string, string>) || {};

    const byStatus: Record<JobStatus, number> = {
      pending: Number(statsHash.pending || 0),
      processing: Number(statsHash.processing || 0),
      completed: Number(statsHash.completed || 0),
      failed: Number(statsHash.failed || 0),
    };

    const totalQueued = queues.critical + queues.normal + queues.low;
    return { queues, totalQueued, dlq, byStatus };
  }

  /** List dead-lettered job records (most recent first). */
  static async getDeadLetterJobs(limit = 50): Promise<Job[]> {
    const ids = await redis.lrange(DLQ_KEY, 0, limit - 1);
    if (ids.length === 0) return [];
    const records = await Promise.all(ids.map((id) => this.getJob(id)));
    return records.filter((j): j is Job => j !== null);
  }

  /** The configured queue-depth warning threshold. */
  static get warnThreshold(): number {
    return QUEUE_WARN_THRESHOLD;
  }
}
