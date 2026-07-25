/**
 * Minimal CI smoke test (#26): proves the Jest harness can boot the app and
 * exercise a real HTTP request/response cycle.
 */

import 'reflect-metadata';
import http from 'http';
import type { AddressInfo } from 'net';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock('../config/redis', () => ({
  __esModule: true,
  default: { get: jest.fn(), set: jest.fn(), on: jest.fn() },
}));
jest.mock('../config/rabbitmq', () => ({
  getChannel: jest.fn().mockReturnValue({ sendToQueue: jest.fn() }),
  initRabbitMQ: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../config/s3', () => ({
  s3: {
    upload: jest.fn().mockReturnValue({
      promise: jest.fn().mockResolvedValue({ Location: 's3://bucket/test-key' }),
    }),
  },
}));
jest.mock('../services/Soroban/SorobanService', () => ({
  SorobanService: jest.fn().mockImplementation(() => ({
    prepareInvocation: jest.fn(),
    submitSignedTransaction: jest.fn(),
  })),
  addressArg: jest.fn((v) => v),
}));

// Several route modules transitively import ESM-only packages (otplib's
// @scure/base, @stellar/stellar-sdk's @noble/hashes) that ts-jest can't
// transform. This smoke test only needs the inline `/health` route in
// app.ts, so stub out the feature routers rather than exercising their
// full service/SDK import chains.
for (const routeModule of [
  '../routes/authRoutes',
  '../routes/artistRoutes',
  '../routes/twitterRoutes',
  '../routes/walletRoutes',
  '../routes/SongRoutes',
  '../routes/marketplaceRoutes',
  '../routes/adminRoutes',
]) {
  jest.mock(routeModule, () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Router } = require('express');
    return { __esModule: true, default: Router() };
  });
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const app = require('../app').default;

describe('GET /health', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll((done) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  it('returns a 200 ok status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
