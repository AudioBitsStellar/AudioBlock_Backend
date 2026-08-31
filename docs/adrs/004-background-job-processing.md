# ADR-004: Background Job Processing Approach

**Date:** 2024-01-01
**Status:** Accepted
**Deciders:** Core team

## Context

Several operations are too slow or unreliable to run synchronously in an HTTP request:

- Audio transcoding and fingerprinting after upload
- Pinning files to IPFS (network-dependent)
- Royalty reconciliation runs
- Soroban contract event indexing

Requirements:

- Jobs must survive process restarts — work cannot be lost if the backend crashes mid-task
- We need visibility into job status (pending, running, failed, completed) for admin tooling
- Different job types have different retry and timeout needs
- The system should not require a dedicated job server tier for the initial deployment

## Decision

Use a **dual-worker architecture**:

1. **RabbitMQ** (`amqplib`) for the audio processing pipeline. `SongProcessorWorker` consumes from a durable queue; messages survive broker restarts. This handles the high-value, long-running transcoding/pinning flow.

2. **Redis-backed job queue** (`ioredis`) for general background jobs (royalty reconciliation, search-index rebuilds, admin-triggered tasks). `JobQueueWorker` polls Redis with `BLPOP` and exposes job status via `GET /api/admin/jobs`. The queue depth is monitored by `startJobQueueMonitor`.

Both workers run in the same Node.js process as the HTTP server for the initial deployment, started via `startSongWorker()` and `startJobQueueWorker()` after the HTTP server binds.

## Consequences

### Positive

- RabbitMQ durable queues guarantee at-least-once delivery for audio processing — no songs are silently dropped
- Redis job queue is lightweight, already in the stack for caching, and gives us admin visibility with minimal code
- Workers co-located with the HTTP server simplify the initial deploy (one container, one Dockerfile)

### Negative / trade-offs

- Co-located workers compete for CPU during high-upload periods; a separate worker process would isolate load
- RabbitMQ is an additional dependency to operate (or pay for as a managed service)
- Redis-based job queue is a home-grown implementation without the full feature set of BullMQ or Agenda

### Neutral

- If load grows, the workers can be extracted to dedicated containers without changing the job-queue protocol — only the `WORKER_ONLY=true` env var and a separate entrypoint are needed

## Alternatives considered

| Option                                | Why rejected                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| BullMQ (Redis only, no RabbitMQ)      | Strong option, but the team had existing RabbitMQ expertise and wanted separate message-broker guarantees for the critical audio pipeline |
| PostgreSQL-backed job queue (pg-boss) | Fewer dependencies but adds write load to the primary DB; poor fit for high-throughput audio events                                       |
| AWS SQS                               | Vendor lock-in; local dev requires LocalStack or mocking                                                                                  |
