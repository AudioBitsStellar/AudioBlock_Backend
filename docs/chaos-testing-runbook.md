# Chaos Testing Runbook (#939, TEST-08)

Pre-launch hardening: kill Postgres, Redis, RabbitMQ and the RPC mid-request and verify the service degrades gracefully.

## Prerequisites

- Docker Compose stack running locally (`docker compose up -d`)
- k6 installed (`brew install k6` or download from grafana/k6)
- Enough load to trigger at least one in-flight request during each kill

## Scenarios

### 1. Kill Postgres mid-request

```bash
# Start load in background
k6 run --duration 60s --vus 20 tests/load/stream-k6.js &

# After ~10s, kill Postgres
docker compose kill db

# Expected: requests in-flight return 503 or connection-error; server recovers
# when Postgres is restarted without process restart.
docker compose start db
```

**Pass criteria:**
- No server crash (process stays alive)
- Error rate < 5% once DB restarts and pool reconnects (within 30 s)
- Logs show `connection refused` or `pool timeout`, not unhandled exceptions

### 2. Kill Redis mid-request

```bash
k6 run --duration 60s --vus 20 tests/load/stream-k6.js &
sleep 10 && docker compose kill redis
```

**Pass criteria:**
- HLS manifest endpoint degrades to cache-miss path (slower, not erroring)
- No 500s leak session tokens or other sensitive data
- Redis reconnects automatically on restart

### 3. Kill RabbitMQ mid-request

```bash
k6 run --duration 60s --vus 10 tests/load/upload-k6.js &
sleep 10 && docker compose kill rabbitmq
```

**Pass criteria:**
- In-flight uploads queue locally or return 503 with `Retry-After`
- No duplicate messages on reconnect
- Consumer resumes processing after broker restart

### 4. Kill RPC / upstream Stellar Horizon mid-request

```bash
# Point BASE_URL at a mock that accepts then drops connections
# or use tc to inject packet loss on the loopback interface.
k6 run --duration 60s --vus 5 tests/load/stream-k6.js &
sleep 10 && sudo tc qdisc add dev lo root netem loss 100%
sleep 15 && sudo tc qdisc del dev lo root
```

**Pass criteria:**
- Stellar payment-watcher logs timeout errors, not crashes
- Pending payment requests remain in `pending` state (not silently dropped)
- Service recovers within one poll interval after connectivity is restored

## Documenting Results

After each scenario, capture:
1. `docker compose logs --since 1m app 2>&1 | tee docs/chaos-results-$(date +%Y%m%d).log`
2. k6 summary JSON: `k6 run --out json=results/chaos-$(date +%Y%m%d).json ...`
3. File a follow-up issue for any crash, data loss, or recovery time > 60 s.
