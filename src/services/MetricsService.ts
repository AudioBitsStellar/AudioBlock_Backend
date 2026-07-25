import client from 'prom-client';

const register = new client.Registry();

client.collectDefaultMetrics({ register });

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP request count',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [register],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const httpRequestsActive = new client.Gauge({
  name: 'http_requests_active',
  help: 'Number of HTTP requests currently in flight',
  registers: [register],
});

export const dbPoolActive = new client.Gauge({
  name: 'db_pool_active',
  help: 'Number of active database connections',
  registers: [register],
});

export const dbPoolIdle = new client.Gauge({
  name: 'db_pool_idle',
  help: 'Number of idle database connections',
  registers: [register],
});

export const dbPoolWaiting = new client.Gauge({
  name: 'db_pool_waiting',
  help: 'Number of queued requests waiting for a database connection',
  registers: [register],
});

export const songsUploadedTotal = new client.Counter({
  name: 'songs_uploaded_total',
  help: 'Total number of songs uploaded',
  registers: [register],
});

export const royaltiesPaidTotal = new client.Counter({
  name: 'royalties_paid_total',
  help: 'Total number of royalty payouts recorded',
  registers: [register],
});

export const marketplaceVolumeStroops = new client.Counter({
  name: 'marketplace_volume_stroops_total',
  help: 'Total marketplace volume in stroops',
  registers: [register],
});

export const cacheHitsTotal = new client.Counter({
  name: 'cache_hits_total',
  help: 'Total number of cache hits',
  registers: [register],
});

export const cacheMissesTotal = new client.Counter({
  name: 'cache_misses_total',
  help: 'Total number of cache misses',
  registers: [register],
});

export async function updateDbPoolMetrics(pool: {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}): Promise<void> {
  dbPoolActive.set(pool.totalCount - pool.idleCount);
  dbPoolIdle.set(pool.idleCount);
  dbPoolWaiting.set(pool.waitingCount);
}

export async function getMetricsContentType(): Promise<string> {
  return register.contentType;
}

export async function getMetrics(): Promise<string> {
  return register.metrics();
}
