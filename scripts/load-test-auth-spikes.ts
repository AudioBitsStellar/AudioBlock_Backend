/**
 * Load Test Script: Concurrent Auth Login Spikes
 *
 * Implements Issue #641:
 * Benchmarks authentication endpoints under concurrent login bursts.
 * Measures latency percentiles (p50, p95, p99), success rates, and
 * verifies that rate limiters (authRateLimiter) throttle gracefully
 * without server crashes or connection pool starvation.
 *
 * Usage:
 *   npx ts-node scripts/load-test-auth-spikes.ts
 *   or:
 *   npm run test:load-auth
 */

import http from 'http';

interface BenchmarkConfig {
  baseUrl: string;
  concurrency: number;
  totalRequests: number;
  endpoint: string;
}

interface BenchmarkResults {
  total: number;
  successful: number;
  rateLimited: number;
  failed: number;
  durations: number[];
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
  rps: number;
}

const config: BenchmarkConfig = {
  baseUrl: process.env.LOAD_TEST_BASE_URL || 'http://localhost:3000',
  concurrency: parseInt(process.env.LOAD_TEST_CONCURRENCY || '50', 10),
  totalRequests: parseInt(process.env.LOAD_TEST_TOTAL || '200', 10),
  endpoint: '/api/v1/auth/login-email',
};

async function executeRequest(url: string, body: object): Promise<{ statusCode: number; duration: number }> {
  const data = JSON.stringify(body);
  const parsedUrl = new URL(url);

  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 3000,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 5000,
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            duration: Date.now() - start,
          });
        });
      }
    );

    req.on('error', (err) => {
      resolve({
        statusCode: 0,
        duration: Date.now() - start,
      });
    });

    req.write(data);
    req.end();
  });
}

export async function runAuthSpikeLoadTest(customConfig?: Partial<BenchmarkConfig>): Promise<BenchmarkResults> {
  const cfg = { ...config, ...customConfig };
  console.log(`\n=== Starting Auth Login Spike Load Test ===`);
  console.log(`Target: ${cfg.baseUrl}${cfg.endpoint}`);
  console.log(`Concurrency: ${cfg.concurrency} VUs | Total Requests: ${cfg.totalRequests}\n`);

  const results: { statusCode: number; duration: number }[] = [];
  const startGlobal = Date.now();

  let sent = 0;
  async function worker() {
    while (sent < cfg.totalRequests) {
      const idx = ++sent;
      const res = await executeRequest(`${cfg.baseUrl}${cfg.endpoint}`, {
        email: `loadtest_${idx % 10}@audioblock.io`,
        password: 'Password123!',
      });
      results.push(res);
    }
  }

  const workers = Array.from({ length: cfg.concurrency }, () => worker());
  await Promise.all(workers);

  const totalTimeSec = (Date.now() - startGlobal) / 1000;
  const durations = results.map((r) => r.duration).sort((a, b) => a - b);

  const successful = results.filter((r) => r.statusCode >= 200 && r.statusCode < 300).length;
  const rateLimited = results.filter((r) => r.statusCode === 429).length;
  const failed = results.filter((r) => r.statusCode === 0 || r.statusCode >= 500).length;

  const p50 = durations[Math.floor(durations.length * 0.5)] || 0;
  const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
  const p99 = durations[Math.floor(durations.length * 0.99)] || 0;
  const avg = Math.round(durations.reduce((a, b) => a + b, 0) / (durations.length || 1));
  const min = durations[0] || 0;
  const max = durations[durations.length - 1] || 0;
  const rps = Math.round(results.length / totalTimeSec);

  const summary: BenchmarkResults = {
    total: results.length,
    successful,
    rateLimited,
    failed,
    durations,
    p50,
    p95,
    p99,
    avg,
    min,
    max,
    rps,
  };

  console.log(`\n=== Results Summary ===`);
  console.log(`Total Requests: ${summary.total}`);
  console.log(`Successful (2xx): ${summary.successful}`);
  console.log(`Rate-Limited (429): ${summary.rateLimited}`);
  console.log(`Server Errors / Failed: ${summary.failed}`);
  console.log(`Throughput: ${summary.rps} req/sec`);
  console.log(`Latency: min=${summary.min}ms, p50=${summary.p50}ms, p95=${summary.p95}ms, p99=${summary.p99}ms, max=${summary.max}ms`);

  return summary;
}

if (require.main === module) {
  runAuthSpikeLoadTest().catch(console.error);
}
