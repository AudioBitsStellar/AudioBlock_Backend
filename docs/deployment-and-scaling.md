# Deployment & Scaling Guide

This guide documents expected resource sizing and scaling for the two
long-running process types in production (Issue #405):

- the **API server** — handles HTTP requests from the artist dashboard and
  listener app;
- the **background worker** — processes uploads by transcoding audio to HLS via
  `ffmpeg` and pinning to IPFS (`SongProcessorWorker`), plus general purpose
  jobs via the Redis-backed `JobQueueWorker`.

The worker runs co-located with the API process by default (a single Node.js
process per container), but can be extracted to a dedicated process with the
standalone worker entrypoint.

## Process types

| Process          | Primary work                                                       | Where it runs                                                               |
| ---------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| API server       | HTTP/JSON, DB queries, Redis cache, auth, uploads (streamed to S3) | `node dist/index.js` (default CMD)                                          |
| Song worker      | ffmpeg HLS packaging + IPFS pin, RabbitMQ consumer                 | co-located by default; standalone via `npm run worker` or `node dist/workers/songWorkerMain.js` |
| Job queue worker | royalties, search-index rebuilds, admin tasks (Redis `BLPOP`)      | co-located by default                                                       |

## Recommended baseline sizing

These are recommended _limits_ per container for a small-to-mid production
deployment. They match what `docker-compose.prod.yml` already applies so a
fresh production deploy starts from a sane, consistent baseline.

| Service                 | CPU                 | Memory               | Notes                                                                 |
| ----------------------- | ------------------- | -------------------- | --------------------------------------------------------------------- |
| API + co-located worker | `0.50` (min `0.25`) | `512M` (min `256M`)  | When workers are co-located, CPU headroom must cover bursty transcode |
| Dedicated song worker   | `1.00` (min `0.75`) | `1024M` (min `512M`) | Provisional budget; measure HLS packaging and provider I/O     |
| Postgres (`db`)         | `0.50`              | `512M`               | Could grow with the library; watch `shared_buffers`/index size        |
| Redis (`redis`)         | `0.25`              | `256M`               | Cache + job queue + rate limiting; grows with key volume              |
| RabbitMQ (`rabbitmq`)   | `0.25`              | `256M`               | Broker only; durable queue state on volume                            |

> These are **starting points**, not a guarantee. Treat them as floors and
> measure (see below) before scaling up.

### Why the worker needs more than the API

`ffmpeg`/`fluent-ffmpeg` currently packages HLS with codec copy. CPU, memory,
disk and provider demand vary with the input and workload. Prefetch defaults to
one active delivery per consumer; measure representative jobs before raising
it. Give dedicated workers their own resource budget so upload processing does
not starve API responses.

## Scaling the worker independently

Scale the worker separately from the API once upload volume or processing latency becomes a
bottleneck:

```bash
# Standalone worker process (no HTTP server)
node dist/workers/songWorkerMain.js
```

or via the registered script after building:

```bash
npm run worker
```

For shared upload storage requirements, bounded prefetch, capacity estimates and
replay limitations, follow the [worker scaling guide](worker-scaling.md). RabbitMQ
shares deliveries across consumers; process loss can redeliver unfinished jobs.
Use the built entry point in production images, where ts-node is not installed.

## Scaling the API

The API can run behind a load balancer, but uploads and its co-located song
consumers require shared local upload storage as described in the worker guide.
When you add instances:

- keep `ALLOWED_ORIGINS` explicit (no wildcards) in production;
- keep the same Postgres/Redis/RabbitMQ backing services shared by all
  instances;
- scale `redis` and `rabbitmq` (or move to a managed offering) before the API
  instances, since they are shared state for all API replicas.

## Measurement method

Baseline any sizing decision on measurements rather than defaults:

1. **Runtime telemetry.** Run with Prometheus metrics enabled and look at
   `process_cpu_seconds_total`, `process_resident_memory_bytes`, and the
   pino-http request logs for p50/p95 latency. Dashboards are provisioned from
   `monitoring/` (Prometheus config + Grafana provisioning).
2. **FFmpeg load.** For worker sizing, measure CPU during an active transcode:
   - `top`/`pidstat` on the container, or
   - Prometheus `container_cpu_usage_seconds_total`, during a controlled batch
     of uploads of your typical audio length (a few 3–5 min tracks).
     Observe the peak core usage; size the CPU limit at ~1.5× the measured peak
     to absorb retries and concurrent jobs.
3. **Memory.** Measure RSS at steady state and at peak transcode. Postgres and
   Redis users should also monitor connections/evictions via their exports.
4. **Sweep across loads.** Re-measure during a "burst" (many simultaneous
   uploads) and a quiet period, then take the highest of the two as your
   sustained requirement, plus ~25% headroom.

Document any deviation from this guide alongside the metric that justified it.

## Database connection-pool sizing (#948)

Each Node.js process holds its own pool of Postgres connections. The pool is
configured in `src/config/constants.ts` (`DB_POOL`). Size each process type's
pool so that the total connections across all running replicas stays comfortably
below Postgres's `max_connections` (default 100 on a standard RDS/Cloud SQL
instance; set explicitly in `docker-compose.prod.yml`).

### Per-process pool defaults

| Process type          | `DB_POOL.MIN` | `DB_POOL.MAX` | Notes                                                     |
| --------------------- | ------------- | ------------- | --------------------------------------------------------- |
| API server            | 2             | 10            | Scales with concurrent HTTP requests                      |
| Dedicated song worker | 2             | 5             | Long-running transcodes hold connections briefly for state updates |
| Job-queue worker      | 2             | 5             | Low-frequency batch jobs; keep headroom for API replicas  |

### Sizing formula

```
total_connections ≤ postgres_max_connections × 0.80
total_connections = (api_replicas × API_MAX)
                  + (worker_replicas × WORKER_MAX)
                  + pgBouncer_overhead (≈ 5 if used)
```

**Alert threshold:** `DBPoolHighUtilization` fires when a pool's active
connections exceed **80%** of its `MAX` for 10 minutes (see
[`db-pool-alerting.md`](db-pool-alerting.md)).  Treat a sustained warning as a
prompt to either raise `DB_POOL.MAX` (and verify Postgres headroom) or add a
`pgBouncer` sidecar to multiplex connections.

### Example: 3 API replicas + 2 dedicated workers

```
(3 × 10) + (2 × 5) = 40 connections  → well under max_connections=100 (40%)
```

If you scale to 8 API replicas: `(8 × 10) + (2 × 5) = 90` — that is 90% of
100, over the alert threshold. Either reduce `DB_POOL.MAX` or raise
`max_connections` before scaling.

## References

- Resource limits in the production overlay: `docker-compose.prod.yml`
- Background job architecture: [`adrs/004-background-job-processing.md`](adrs/004-background-job-processing.md)
- Metrics/monitoring setup: `monitoring/`
- Pool alert rules: [`db-pool-alerting.md`](db-pool-alerting.md)
