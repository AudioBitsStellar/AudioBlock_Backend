#!/usr/bin/env bash
#
# Time-to-First-Request Benchmark (#368)
#
# Measures how long it takes from `docker compose up` to the first successful
# HTTP 200 from the health endpoint. Run this after a fresh clone to verify
# your local dev environment boots correctly.
#
# Usage:
#   ./scripts/benchmark-time-to-first-request.sh
#
# Requirements:
#   - Docker and Docker Compose v2
#   - curl
#
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-http://localhost:4000/health/live}"
MAX_WAIT="${MAX_WAIT:-120}"
INTERVAL="${INTERVAL:-2}"

echo "=== Time-to-First-Request Benchmark ==="
echo "Health endpoint: $HEALTH_URL"
echo "Max wait: ${MAX_WAIT}s"
echo ""

# Record start time
START=$(date +%s%N)

echo "Starting services..."
docker compose up -d --build 2>&1 | tail -5

echo ""
echo "Waiting for first successful request..."

ATTEMPTS=0
while [ $ATTEMPTS -lt $((MAX_WAIT / INTERVAL)) ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "200" ]; then
    END=$(date +%s%N)
    ELAPSED_MS=$(( (END - START) / 1000000 ))
    ELAPSED_S=$(echo "scale=2; $ELAPSED_MS / 1000" | bc)

    echo ""
    echo "=== Results ==="
    echo "First 200 OK after: ${ELAPSED_S}s (${ELAPSED_MS}ms)"
    echo "Attempts: $ATTEMPTS"
    echo "HTTP status: $HTTP_CODE"
    echo ""

    # Grade the result
    if [ $ELAPSED_MS -lt 30000 ]; then
      echo "Grade: EXCELLENT (< 30s)"
    elif [ $ELAPSED_MS -lt 60000 ]; then
      echo "Grade: GOOD (< 60s)"
    elif [ $ELAPSED_MS -lt 90000 ]; then
      echo "Grade: ACCEPTABLE (< 90s)"
    else
      echo "Grade: SLOW (> 90s) — investigate cold-start or dependency init"
    fi

    exit 0
  fi

  sleep $INTERVAL
done

echo ""
echo "FAILED: No 200 response within ${MAX_WAIT}s"
echo "Last HTTP status: $HTTP_CODE"
echo ""
echo "Debug tips:"
echo "  docker compose logs backend --tail=50"
echo "  docker compose ps"
exit 1
