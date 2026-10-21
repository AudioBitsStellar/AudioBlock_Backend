# HTTP and Queue Alert Runbook

These alerts are defined in [`monitoring/prometheus-alerts.yml`](../../monitoring/prometheus-alerts.yml)
and visualized in the `audioblock-app` Grafana dashboard.

## HighHttp5xxRate

Fires when more than 5% of requests return 5xx responses for 10 minutes, with
at least 0.1 requests per second. Check the backend logs for the affected
routes and correlate failures with database, Redis, and Soroban availability.
Roll back or disable a recent failing integration when appropriate, then
confirm the error ratio falls below threshold.

## HighHttpP95Latency

Fires when estimated p95 request latency exceeds 2.5 seconds for 10 minutes.
Inspect slow routes and database pool metrics, then check dependency latency,
queue health, and recent deployments. Scale or mitigate the saturated
dependency and verify p95 returns below threshold.

## SongProcessingQueueBacklog and CriticalSongProcessingQueueBacklog

Check the RabbitMQ `song_processing` queue, worker health, and worker logs.
Confirm FFmpeg is installed and that S3 and Pinata are reachable. Restart or
scale song workers only after identifying whether messages are failing or
consumers are unavailable. For sustained worker issues, see the
[`worker-scaling` runbook](../worker-scaling.md).

## Validation

Run the simulated firing scenarios with Prometheus tooling:

```sh
promtool check rules monitoring/prometheus-alerts.yml
promtool test rules monitoring/alerts.test.yml
```
