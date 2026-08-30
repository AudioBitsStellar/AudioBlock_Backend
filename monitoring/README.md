# Monitoring — Dashboard-as-Code

This directory holds the monitoring configuration for AudioBlock Backend as
version-controlled code (Issue #382). Nothing here has to be exported by hand
from a running Grafana — every dashboard lives in this repo as JSON and is
provisioned automatically on container startup.

## Layout

```
monitoring/
├── prometheus.yml        # Prometheus scrape config (targets the backend /metrics)
├── grafana/
│   └── provisioning.yml  # Grafana provisioning: Prometheus datasource + dashboards provider
└── dashboards/
    ├── audioblock-app.json   # Express app / HTTP / DB-pool / cache / royalties dashboard
    └── audioblock-node.json  # Host system (CPU / memory / disk / network) overview
```

## How it works

`docker-compose.yml` starts a Prometheus instance and a Grafana instance.

- Prometheus scrapes the backend's `GET /metrics` endpoint (exposed by
  `prom-client` in `src/services/MetricsService.ts`) using
  `./monitoring/prometheus.yml`.
- Grafana is provisioned entirely from disk:
  - `./monitoring/grafana/provisioning.yml` is mounted to
    `/etc/grafana/provisioning/provisioning.yml` — it defines the Prometheus
    datasource and a file-based dashboard provider.
  - `./monitoring/dashboards/` is mounted to
    `/etc/grafana/provisioning/dashboards` — this is the provider's
    `path`, so every dashboard JSON in the directory is automatically loaded.

Any dashboard JSON added to `monitoring/dashboards/` is picked up by Grafana
within `updateIntervalSeconds` (10s) — no manual import required.

## The dashboards

### `audioblock-app.json`

Visualisations of the application metrics emitted by `MetricsService`:

- `http_requests_total` (rate by method, and 5xx by route)
- `http_request_duration_seconds` (histogram → p95 / p99)
- `http_requests_active`
- `db_pool_active` / `db_pool_idle` / `db_pool_waiting`
- `songs_uploaded_total`
- `cache_hits_total` / `cache_misses_total`
- `marketplace_volume_stroops_total`
- `royalties_paid_total`

### `audioblock-node.json`

Host/system overview using standard `prometheus-node-exporter` metrics
(`node_cpu_seconds_total`, `node_memory_*`, `node_load*`, `node_network_*`,
`node_filesystem_*`, `node_boot_time_seconds`). These become available once a
node exporter is added to the compose topology and scraped — confirm the scrape
job exists before relying on them.

## Adding a dashboard

1. Create (or copy) a `*.json` file under `monitoring/dashboards/`.
2. Keep it valid JSON and reference the `Prometheus` datasource.
3. Restart Grafana (`docker compose up -d grafana`) or wait for the 10s
   reload; the new dashboard appears in the dashboards list.
