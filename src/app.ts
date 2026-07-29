import cookieParser from 'cookie-parser';
import express, { Request, Response, RequestHandler, ErrorRequestHandler } from 'express';
import swaggerUi from 'swagger-ui-express';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { requestLoggerMiddleware } from './middlewares/requestLogger';
import { metricsMiddleware } from './middlewares/metricsMiddleware';
import { getMetrics, getMetricsContentType, updateDbPoolMetrics } from './services/MetricsService';
import cors from 'cors';
import { corsOptions } from './config/cors';
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
import albumRoutes from './routes/AlbumRoutes';
import royaltyTemplateRoutes from './routes/royaltyTemplateRoutes';
import chartRoutes from './routes/ChartRoutes';
import tagRoutes from './routes/TagRoutes';
import releaseRoutes from './routes/ReleaseRoutes';
import subscriptionRoutes from './routes/subscriptionRoutes';
import { getPoolStats, checkDbHealth } from './services/DbPoolMonitor';
import { dbConnectionState } from './services/DatabaseConnectionManager';
import { JSON_BODY_LIMIT, URLENCODED_BODY_LIMIT } from './config/constants';
import { isPayloadTooLargeError } from './middlewares/bodySizeLimit';
import { sanitizeInput } from './middlewares/sanitizeInput';
import { logRequestError } from './utils/errorLogger';

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

// CORS configuration (Issue #107)
// ALLOWED_ORIGINS env var accepts a comma-separated list of origins.
// In production, wildcards are rejected and an explicit list is required.
app.use(cors(corsOptions));

// #109 — explicit size limits so an oversized body is rejected with a clear
// 413 before it's ever fully buffered/parsed into memory, rather than
// relying on body-parser's un-configured (100kb) default.
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: URLENCODED_BODY_LIMIT }));

// Sanitize request bodies against stored XSS before they reach routes (Issue #101).
// Runs after body parsing so req.body is populated; skips binary/multipart uploads.
app.use(sanitizeInput);

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

// Album listing (paginated)
app.use('/api/album', albumRoutes);

// Royalty split templates (Issue #98)
app.use('/api/royalty-templates', royaltyTemplateRoutes);

// Trending charts (Issue #94)
app.use('/api/charts', chartRoutes);

// Tags/labels (Issue #93)
app.use('/api/tags', tagRoutes);

// Music releases/EPs (Issue #95)
app.use('/api/releases', releaseRoutes);

// Marketplace Soroban relay (list + buy)
app.use('/api/marketplace', marketplaceRoutes);

// Admin moderation routes
app.use('/api/admin', adminRoutes);

// User profile routes
app.use('/api/user', userRoutes);

// Subscription management routes (Issue #99)
app.use('/api/users', subscriptionRoutes);
app.use('/api/subscriptions', subscriptionRoutes);

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
      const message =
        'Database connection unavailable — write operations suspended. Please try again later.';
      logRequestError(req, new Error(message), 503);
      res.setHeader('Retry-After', '30');
      return res.status(503).json({
        error: 'Service Unavailable',
        message,
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

  // #107 — CORS origin check failure returns 403 with a clear message
  // instead of the default CORS header omission (which silently fails in
  // the browser and provides no actionable feedback).
  if (err.message === 'Origin not allowed by CORS') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Origin not allowed',
    });
  }

  // #109 — express.json()/express.urlencoded() reject a body over their
  // configured `limit` with a body-parser error (type "entity.too.large"),
  // which without this branch falls through to the generic 500 handler
  // below and hides the real, client-fixable cause.
  if (isPayloadTooLargeError(err)) {
    return {
      statusCode: 413,
      body: {
        error: 'Payload Too Large',
        message: 'Request body exceeds the maximum allowed size.',
      },
    };
  }

  // Multer file-size limit exceeded
  if (err.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE') {
    return {
      statusCode: 413,
      body: {
        error: 'Payload Too Large',
        message: 'Uploaded file exceeds the maximum allowed size.',
      },
    };
  }

  // Other multer errors (file filter rejections, unexpected fields, etc.)
  if (err.name === 'MulterError') {
    return { statusCode: 400, body: { error: 'Bad Request', message: err.message } };
  }

  // File filter rejection errors are passed as plain Error through Express
  if (err instanceof Error && /Invalid file type|allowed/i.test(err.message)) {
    return { statusCode: 400, body: { error: 'Bad Request', message: err.message } };
  }

  return {
    statusCode: 500,
    body: {
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    },
  };
};

const customErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const { statusCode, body } = classifyError(err);
  logRequestError(req, err, statusCode);
  res.status(statusCode).json(body);
};

app.use(customErrorHandler);

// Handle 404 errors
app.use(((req: Request, res: Response) => {
  logRequestError(req, new Error(`Route ${req.originalUrl} not found`), 404);
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.originalUrl} not found` },
  });
}) as RequestHandler);

// Export app
export default app;
