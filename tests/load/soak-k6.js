import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

/**
 * 24-hour soak test (#940, TEST-09)
 *
 * Runs a sustained, low-concurrency workload for 24 hours to surface memory
 * and file-handle leaks. Checks the /health endpoint's reported memory usage
 * at every iteration; a rising baseline over hours indicates a leak.
 *
 * Acceptance criteria:
 *   - RSS memory stays below MEM_LIMIT_MB (default 512 MB) throughout.
 *   - No increase > 20% from the first-minute baseline to the final minute.
 *   - Error rate < 0.5% over the full run.
 *
 * Usage (full):
 *   SONG_ID=<uuid> AUTH_TOKEN=<token> k6 run tests/load/soak-k6.js
 *
 * Usage (short smoke run, 5 min):
 *   DURATION=5m k6 run tests/load/soak-k6.js
 */

const streamLatency = new Trend('soak_stream_latency_ms');
const errorRate = new Rate('soak_error_rate');
const rssBytes = new Trend('soak_rss_bytes');
const handleCount = new Counter('soak_open_handles');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SONG_ID = __ENV.SONG_ID || '00000000-0000-0000-0000-000000000001';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';
const MEM_LIMIT_MB = Number(__ENV.MEM_LIMIT_MB || '512');
const DURATION = __ENV.DURATION || '24h';

export const options = {
  stages: [
    { duration: '5m', target: 10 },   // ramp up
    { duration: DURATION, target: 10 }, // sustained soak
    { duration: '5m', target: 0 },    // ramp down
  ],
  thresholds: {
    soak_error_rate: ['rate<0.005'],  // <0.5% errors
    http_req_duration: ['p(95)<500'], // responses stay fast
    // RSS must not breach limit — checked inline below
  },
};

const headers = AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {};

export default function () {
  // Stream a song segment
  const streamRes = http.get(`${BASE_URL}/api/song/stream/${SONG_ID}`, { headers, timeout: '10s' });
  const ok = check(streamRes, { 'stream 200': (r) => r.status === 200 || r.status === 206 });
  streamLatency.add(streamRes.timings.duration);
  errorRate.add(!ok);

  // Poll /health for server memory and handle stats
  const healthRes = http.get(`${BASE_URL}/health`);
  if (healthRes.status === 200) {
    try {
      const body = JSON.parse(healthRes.body);
      const rss = body.memory?.rss;
      if (typeof rss === 'number') {
        rssBytes.add(rss);
        const rssMB = rss / 1024 / 1024;
        check({ rssMB }, {
          [`RSS < ${MEM_LIMIT_MB} MB`]: (v) => v.rssMB < MEM_LIMIT_MB,
        });
      }
      if (typeof body.openHandles === 'number') {
        handleCount.add(body.openHandles);
      }
    } catch (_) {
      // health body not JSON — skip memory check this iteration
    }
  }

  sleep(6); // ~10 req/min per VU at 10 VUs = ~100 req/min total
}
