import Redis from 'ioredis';
import logger from './logger';

const isTest = process.env.NODE_ENV === 'test';

const redis = new Redis({
  username: process.env.REDIS_USERNAME,
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  // tls: {}, // Required for Redis Cloud TLS
  maxRetriesPerRequest: null, //  prevents retry errors
  lazyConnect: isTest,
  retryStrategy: isTest ? () => null : undefined,
});

redis.on('connect', () => {
  logger.info('Connected to Redis');
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis error');
});

export default redis;
