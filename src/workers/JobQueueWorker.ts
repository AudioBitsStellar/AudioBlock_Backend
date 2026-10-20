/**
 * Job queue worker + monitor (Issue #132)
 * ────────────────────────────────────────
 * Drains the priority job queue (see JobQueueService) by reserving jobs and
 * dispatching them to registered handlers. Handlers are keyed by job `type`.
 * Failures are retried with backoff and eventually dead-lettered by the queue
 * service.
 *
 * A separate monitor logs queue depth periodically and warns when the total
 * number of queued jobs crosses the configured threshold.
 *
 * Usage:
 *   registerJobHandler("transcode", async (job) => { ... });
 *   startJobQueueWorker();
 */
import redis from '../config/redis';
import logger from '../config/logger';
import { Job, JobQueueService } from '../services/JobQueueService';
import { EmailService } from '../services/EmailService';

type JobHandler = (job: Job) => Promise<void>;

const handlers = new Map<string, JobHandler>();

let running = false;
let monitorTimer: NodeJS.Timeout | null = null;

const MONITOR_INTERVAL_MS = Number(process.env.JOB_MONITOR_INTERVAL_MS || 30000);

/** Register a handler for a given job type. */
export function registerJobHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler);
  logger.info({ type }, 'Registered job handler');
}

/**
 * Start the background worker loop. Uses a dedicated (duplicated) Redis
 * connection because BRPOP blocks the connection it runs on.
 */
export function startJobQueueWorker(): void {
  if (running) return;
  running = true;

  const blockingClient = redis.duplicate();
  blockingClient.on('error', (err) => logger.error({ err }, 'Job queue blocking client error'));

  const loop = async () => {
    logger.info('⚙️  Job queue worker started');
    while (running) {
      try {
        const job = await JobQueueService.reserve(blockingClient, 5);
        if (!job) continue; // timeout — poll again

        const handler = handlers.get(job.type);
        if (!handler) {
          // No handler registered for this type — fail it so it retries or
          // dead-letters rather than silently vanishing.
          await JobQueueService.fail(
            job,
            new Error(`No handler registered for job type "${job.type}"`),
          );
          continue;
        }

        try {
          await handler(job);
          await JobQueueService.complete(job);
        } catch (err) {
          await JobQueueService.fail(job, err);
        }
      } catch (err) {
        logger.error({ err }, 'Job queue worker loop error');
        // Brief pause so a persistent error (e.g. Redis down) doesn't hot-loop.
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    blockingClient.disconnect();
  };

  void loop();
}

/** Stop the worker loop. */
export function stopJobQueueWorker(): void {
  running = false;
}

/**
 * Start periodic queue-depth monitoring. Logs stats every interval and warns
 * when queued jobs exceed the configured threshold. Returns a stop function.
 */
export function startJobQueueMonitor(): () => void {
  if (monitorTimer) return stopJobQueueMonitor;

  monitorTimer = setInterval(() => {
    JobQueueService.getStats()
      .then((stats) => {
        if (stats.totalQueued > JobQueueService.warnThreshold) {
          logger.warn(
            stats,
            `Job queue depth ${stats.totalQueued} exceeds threshold ${JobQueueService.warnThreshold}`,
          );
        } else {
          logger.info(stats, 'Job queue stats');
        }
      })
      .catch((err) => logger.error({ err }, 'Job queue monitor failed'));
  }, MONITOR_INTERVAL_MS);

  if (typeof monitorTimer.unref === 'function') monitorTimer.unref();
  return stopJobQueueMonitor;
}

export function stopJobQueueMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

/**
 * Email job payload for transactional email delivery via job queue (Issue #798).
 * Stores template name and variables rather than pre-rendered HTML so retries
 * can render fresh content.
 */
export interface EmailJobPayload {
  to: string;
  subject: string;
  html: string;
}

/**
 * Email job handler (Issue #798).
 * Sends transactional emails with retry on 5xx/timeouts, no retry on 4xx
 * (bad address), and logs provider message ID on success.
 */
async function handleEmailJob(job: Job<EmailJobPayload>): Promise<void> {
  const { to, subject, html } = job.payload;
  const emailService = new EmailService();

  try {
    const messageId = await emailService.sendEmail(to, subject, html);
    if (messageId) {
      logger.info({ jobId: job.id, to, subject, messageId }, 'Email sent successfully');
    } else {
      logger.info({ jobId: job.id, to, subject }, 'Email send skipped (no API key configured)');
    }
  } catch (error: any) {
    const status = error?.response?.status;

    // Don't retry 4xx errors (bad address, invalid payload, etc.)
    if (status && status >= 400 && status < 500) {
      logger.error(
        { jobId: job.id, to, subject, status, error: error.message },
        'Email send failed with client error, not retrying',
      );
      // Mark as complete to avoid retry
      return;
    }

    // Retry 5xx and network errors
    logger.warn(
      { jobId: job.id, to, subject, status, error: error.message, attempt: job.attempts },
      'Email send failed, will retry',
    );
    throw error;
  }
}

// Register the email job handler
registerJobHandler('email.send', handleEmailJob);
