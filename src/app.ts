import cookieParser from 'cookie-parser';
import express, { Request, Response, RequestHandler, ErrorRequestHandler } from 'express';
import swaggerUi from 'swagger-ui-express';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import logger from './config/logger';
import { requestLoggerMiddleware } from './middlewares/requestLogger';
import { metricsMiddleware } from './middlewares/metricsMiddleware';
import { getMetrics, getMetricsContentType, updateDbPoolMetrics } from './services/MetricsService';
import cors from 'cors';
import redis from './config/redis';
import AppDataSource from './config/db';
import authRoutes from './routes/authRoutes';
import artistRoutes from './routes/artistRoutes';
import twitterRoutes from './routes/twitterRoutes';
import walletRoutes from './routes/walletRoutes';
import SongRoutes from './routes/SongRoutes';
import userRoutes from './routes/userRoutes';
import marketplaceRoutes from './routes/marketplaceRoutes';
import adminRoutes from './routes/adminRoutes';
import healthRoutes from './routes/healthRoutes';
import { getPoolStats, checkDbHealth } from './services/DbPoolMonitor';
import { dbConnectionState } from './services/DatabaseConnectionManager';
import { JSON_BODY_LIMIT, URLENCODED_BODY_LIMIT } from './config/constants';
import { isPayloadTooLargeError } from './middlewares/bodySizeLimit';

// Route imports

// Initialize express app
const app = express();

// Apply middleware
// Apply global middlewares
app.use(cookieParser());
// Structured request logging with correlation id (Issue #33)
app.use(requestLoggerMiddleware);
// Prometheus metrics tracking (skips /metrics path internally)
app.use(metricsMiddleware);

// CORS configuration
// In production set ALLOWED_ORIGINS to a comma-separated list of the deployed
// listener-app and artist-dashboard domains, e.g.:
//   ALLOWED_ORIGINS=https://listener.audioblockz.com,https://artist.audioblockz.com
const allowedOrigins: string[] = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:5500'];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
    ],
    exposedHeaders: ['Authorization'],
    maxAge: 86400, // 24 hours
  }),
);

// #109 — explicit size limits so an oversized body is rejected with a clear
// 413 before it's ever fully buffered/parsed into memory, rather than
// relying on body-parser's un-configured (100kb) default.
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: URLENCODED_BODY_LIMIT }));

// Add timeout configurations
app.use((req, res, next) => {
  req.setTimeout(30000); // 30 seconds
  res.setTimeout(30000); // 30 seconds
  next();
});

// Log application startup

// Prometheus metrics endpoint
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const pool = (AppDataSource.driver as any).master;
    if (pool?.totalCount !== undefined) {
      await updateDbPoolMetrics(pool);
    }
  } catch {
    // DB not connected — report zeros
  }
  res.setHeader('Content-Type', await getMetricsContentType());
  res.end(await getMetrics());
});

// Define routes
app.get('/health', (req, res) => {
  if (isShuttingDown()) {
    res.status(503).json({ status: 'shutting_down' });
    return;
  }
  res.json({ status: 'ok' });
});

// Database connection-pool status (Issue #134). Reports live pool metrics and
// runs a health-check query; returns 503 when the pool can't serve a query.
app.get('/health/db', async (req, res) => {
  const healthy = await checkDbHealth(AppDataSource);
  const pool = getPoolStats(AppDataSource);
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'unhealthy',
    pool,
    connection: dbConnectionState,
  });
});

// Liveness / readiness / detailed health probes for orchestration and load
// balancer configuration (Issue #146): GET /health/live, /health/ready,
// /health/detailed.
app.use('/health', healthRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/artist', artistRoutes);

// Dynamic wallet routes
app.use('/api/wallet', walletRoutes);

// Song wallet
app.use('/api/song', SongRoutes);

// Marketplace Soroban relay (list + buy)
app.use('/api/marketplace', marketplaceRoutes);

// Admin moderation routes
app.use('/api/admin', adminRoutes);

// User profile routes
app.use('/api/user', userRoutes);

//TWITTER CALLBACK ROUTE
app.use('/api/auth/twitter', twitterRoutes);

// Swagger UI — served at /api/docs in all environments
const openapiPath = path.resolve(__dirname, '../../docs/openapi.yaml');
if (fs.existsSync(openapiPath)) {
  const openapiDoc = yaml.load(fs.readFileSync(openapiPath, 'utf8')) as object;
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiDoc));
}

if (process.env.NODE_ENV !== 'production') {
  app.get('/redis-test', async (req, res) => {
    await redis.set('greeting', 'hello world');
    const value = await redis.get('greeting');
    res.send({ value });
  });
}

// Error handling middleware

// Circuit breaker middleware (Issue #127): returns 503 with Retry-After for
// write operations when database connection is unavailable.
const circuitBreakerMiddleware: RequestHandler = (req, res, next) => {
  if (!dbConnectionState.connected && !dbConnectionState.reconnecting) {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      res.setHeader('Retry-After', '30');
      return res.status(503).json({
        error: 'Service Unavailable',
        message:
          'Database connection unavailable — write operations suspended. Please try again later.',
      });
    }
  }
  next();
};

app.use(circuitBreakerMiddleware);

const customErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  logger.error(
    { reqId: (req as any).id, err, route: req.originalUrl, method: req.method },
    'Unhandled error',
  );

  // #109 — express.json()/express.urlencoded() reject a body over their
  // configured `limit` with a body-parser error (type "entity.too.large"),
  // which without this branch falls through to the generic 500 handler
  // below and hides the real, client-fixable cause.
  if (isPayloadTooLargeError(err)) {
    return res.status(413).json({
      error: 'Payload Too Large',
      message: 'Request body exceeds the maximum allowed size.',
    });
  }

  // Multer file-size limit exceeded
  if (err.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'Payload Too Large',
      message: 'Uploaded file exceeds the maximum allowed size.',
    });
  }

  // Other multer errors (file filter rejections, unexpected fields, etc.)
  if (err.name === 'MulterError') {
    return res.status(400).json({
      error: 'Bad Request',
      message: err.message,
    });
  }

  // File filter rejection errors are passed as plain Error through Express
  if (err instanceof Error && /Invalid file type|allowed/i.test(err.message)) {
    return res.status(400).json({
      error: 'Bad Request',
      message: err.message,
    });
  }

  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
};

app.use(customErrorHandler);

// Handle 404 errors
app.use(((req: Request, res: Response) => {
  logger.warn({ reqId: (req as any).id, route: req.originalUrl }, '404 - Route not found');
  res.status(404).json({
    error: 'error',
    message: `Route ${req.originalUrl} not found`,
  });
}) as RequestHandler);

// Export app
export default app;
