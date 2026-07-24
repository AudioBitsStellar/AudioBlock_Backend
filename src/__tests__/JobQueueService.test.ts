/**
 * Unit tests for the background job queue (Issue #132).
 * Uses an in-memory Redis mock covering strings, lists and hashes.
 */
import "reflect-metadata";

jest.mock("../config/redis", () => {
  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const hashes = new Map<string, Map<string, string>>();

  const _set = (k: string, v: string) => (strings.set(k, v), "OK");
  const _get = (k: string) => (strings.has(k) ? strings.get(k)! : null);
  const _lpush = (k: string, v: string) => {
    if (!lists.has(k)) lists.set(k, []);
    lists.get(k)!.unshift(v);
    return lists.get(k)!.length;
  };
  const _llen = (k: string) => lists.get(k)?.length ?? 0;
  const _lrange = (k: string, start: number, stop: number) => {
    const arr = lists.get(k) ?? [];
    return arr.slice(start, stop === -1 ? undefined : stop + 1);
  };
  const _hincrby = (k: string, f: string, n: number) => {
    if (!hashes.has(k)) hashes.set(k, new Map());
    const h = hashes.get(k)!;
    const cur = Number(h.get(f) || 0) + n;
    h.set(f, String(cur));
    return cur;
  };
  const _hgetall = (k: string) => {
    const h = hashes.get(k);
    return h ? Object.fromEntries(h) : {};
  };

  const pipeline = () => {
    const ops: Array<() => any> = [];
    const api: any = {
      hincrby: (k: string, f: string, n: number) => (ops.push(() => _hincrby(k, f, n)), api),
      llen: (k: string) => (ops.push(() => _llen(k)), api),
      hgetall: (k: string) => (ops.push(() => _hgetall(k)), api),
      set: (k: string, v: string) => (ops.push(() => _set(k, v)), api),
      exec: async () => ops.map((fn) => [null, fn()]),
    };
    return api;
  };

  return {
    __esModule: true,
    default: {
      set: async (k: string, v: string) => _set(k, v),
      get: async (k: string) => _get(k),
      lpush: async (k: string, v: string) => _lpush(k, v),
      llen: async (k: string) => _llen(k),
      lrange: async (k: string, s: number, e: number) => _lrange(k, s, e),
      hincrby: async (k: string, f: string, n: number) => _hincrby(k, f, n),
      hgetall: async (k: string) => _hgetall(k),
      pipeline,
      __reset: () => {
        strings.clear();
        lists.clear();
        hashes.clear();
      },
    },
  };
});

import redis from "../config/redis";
import { JobQueueService, Job } from "../services/JobQueueService";

beforeEach(() => (redis as any).__reset());

describe("JobQueueService.backoffDelay", () => {
  it("grows exponentially and caps at the ceiling", () => {
    expect(JobQueueService.backoffDelay(1)).toBe(2000);
    expect(JobQueueService.backoffDelay(2)).toBe(4000);
    expect(JobQueueService.backoffDelay(3)).toBe(8000);
    // Large attempt is capped (default max 30000).
    expect(JobQueueService.backoffDelay(20)).toBe(30000);
  });
});

describe("JobQueueService.enqueue / getStats", () => {
  it("enqueues a pending job at the requested priority", async () => {
    const job = await JobQueueService.enqueue("transcode", { songId: "s1" }, { priority: "critical" });

    expect(job.status).toBe("pending");
    expect(job.priority).toBe("critical");
    expect(job.attempts).toBe(0);

    const stats = await JobQueueService.getStats();
    expect(stats.queues.critical).toBe(1);
    expect(stats.totalQueued).toBe(1);
    expect(stats.byStatus.pending).toBe(1);
  });

  it("round-trips a job record via getJob", async () => {
    const job = await JobQueueService.enqueue("pin", { cid: "Qm..." });
    const fetched = await JobQueueService.getJob(job.id);
    expect(fetched?.id).toBe(job.id);
    expect(fetched?.type).toBe("pin");
  });
});

describe("JobQueueService.fail", () => {
  const baseJob = (): Job => ({
    id: "j1",
    type: "transcode",
    payload: {},
    priority: "normal",
    status: "processing",
    attempts: 1,
    maxAttempts: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  it("retries when attempts remain", async () => {
    jest.useFakeTimers();
    const job = baseJob();

    const retried = await JobQueueService.fail(job, new Error("boom"));
    expect(retried).toBe(true);
    expect(job.status).toBe("pending");
    expect(job.lastError).toBe("boom");

    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("dead-letters when attempts are exhausted", async () => {
    const job = baseJob();
    job.attempts = 3; // == maxAttempts

    const retried = await JobQueueService.fail(job, new Error("fatal"));
    expect(retried).toBe(false);
    expect(job.status).toBe("failed");

    const stats = await JobQueueService.getStats();
    expect(stats.dlq).toBe(1);
    expect(stats.byStatus.failed).toBe(1);

    const dlqJobs = await JobQueueService.getDeadLetterJobs();
    expect(dlqJobs.map((j) => j.id)).toContain("j1");
  });
});
