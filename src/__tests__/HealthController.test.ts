import 'reflect-metadata';
import { Request, Response } from 'express';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { query: jest.fn(), driver: {} },
  dbPoolConfig: { max: 20, min: 5, connectionTimeoutMillis: 30000, idleTimeoutMillis: 300000 },
}));
jest.mock('../config/redis', () => ({
  __esModule: true,
  default: { ping: jest.fn(), get: jest.fn(), set: jest.fn(), on: jest.fn() },
}));
jest.mock('axios');

import AppDataSource from '../config/db';
import redis from '../config/redis';
import axios from 'axios';
import { HealthController } from '../controllers/HealthController';
import logger from '../config/logger';

const buildResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
};

describe('HealthController', () => {
  const originalRedisHost = process.env.REDIS_HOST;
  const originalPinataGateway = process.env.PINATA_GATEWAY;
  const originalPinataJwt = process.env.PINATA_JWT;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
    process.env.REDIS_HOST = 'localhost';
    process.env.PINATA_GATEWAY = 'gateway.pinata.cloud';
    process.env.PINATA_JWT = 'test-jwt';
  });

  afterAll(() => {
    process.env.REDIS_HOST = originalRedisHost;
    process.env.PINATA_GATEWAY = originalPinataGateway;
    process.env.PINATA_JWT = originalPinataJwt;
  });

  it('live returns 200 with status ok, timestamp and uptime, without touching dependencies', () => {
    const req = {} as Request;
    const res = buildResponse();

    HealthController.live(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptime).toBe('number');
    expect(AppDataSource.query).not.toHaveBeenCalled();
  });

  it('ready returns 200 when all dependencies are healthy', async () => {
    (AppDataSource.query as jest.Mock).mockResolvedValue([{ '?column?': 1 }]);
    (redis.ping as jest.Mock).mockResolvedValue('PONG');
    (axios.get as jest.Mock).mockResolvedValue({ status: 200 });

    const req = {} as Request;
    const res = buildResponse();

    await HealthController.ready(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.status).toBe('ok');
    expect(body.dependencies.database.status).toBe('ok');
    expect(body.dependencies.redis.status).toBe('ok');
    expect(body.dependencies.pinata.status).toBe('ok');
  });

  it('ready returns 503 and logs a warning when the database is unreachable', async () => {
    (AppDataSource.query as jest.Mock).mockRejectedValue(new Error('connection refused'));
    (redis.ping as jest.Mock).mockResolvedValue('PONG');
    (axios.get as jest.Mock).mockResolvedValue({ status: 200 });

    const req = {} as Request;
    const res = buildResponse();

    await HealthController.ready(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.status).toBe('unhealthy');
    expect(body.dependencies.database.status).toBe('error');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('ready treats Redis as not_configured when REDIS_HOST is unset', async () => {
    delete process.env.REDIS_HOST;
    (AppDataSource.query as jest.Mock).mockResolvedValue([{ '?column?': 1 }]);
    (axios.get as jest.Mock).mockResolvedValue({ status: 200 });

    const req = {} as Request;
    const res = buildResponse();

    await HealthController.ready(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.dependencies.redis.status).toBe('not_configured');
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('detailed includes dependency statuses, db pool stats, and memory usage', async () => {
    (AppDataSource.query as jest.Mock).mockResolvedValue([{ '?column?': 1 }]);
    (redis.ping as jest.Mock).mockResolvedValue('PONG');
    (axios.get as jest.Mock).mockResolvedValue({ status: 200 });

    const req = {} as Request;
    const res = buildResponse();

    await HealthController.detailed(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.dependencies).toBeDefined();
    expect(body.dbPool).toBeDefined();
    expect(body.memory).toBeDefined();
    expect(typeof body.uptime).toBe('number');
  });
});
