import express from 'express';
import crypto from 'crypto';
import request from 'supertest';
import logger from '../../config/logger';
import privyWebhookRoutes from '../privyWebhookRoutes';

jest.mock('../../config/db', () => {
  const findOne = jest.fn();
  const save = jest.fn();
  const getRepository = jest.fn();
  getRepository.mockReturnValue({ findOne, save });
  return {
    __esModule: true,
    default: { getRepository },
    __mocks: { getRepository, findOne, save },
  };
});

jest.mock('../../services/UserService', () => {
  const createUser = jest.fn();
  return {
    UserService: jest.fn().mockImplementation(() => ({ createUser })),
    __mocks: { createUser },
  };
});

jest.mock('../../config/redis', () => {
  const set = jest.fn();
  const del = jest.fn();
  const incr = jest.fn().mockResolvedValue(1);
  const expire = jest.fn().mockResolvedValue(1);
  return {
    __esModule: true,
    default: { set, del, incr, expire },
    __mocks: { set, del, incr, expire },
  };
});

const { findOne: mockFindOne, save: mockSave } = jest.requireMock('../../config/db').__mocks;
const { createUser: mockCreateUser } = jest.requireMock('../../services/UserService').__mocks;
const { set: mockRedisSet, del: mockRedisDel } = jest.requireMock('../../config/redis').__mocks;
const mockGetRepository = jest.requireMock('../../config/db').__mocks.getRepository;

const app = express();
app.use('/api', privyWebhookRoutes);

function signatureFor(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto
    .createHmac('sha256', process.env.PRIVY_WEBHOOK_SECRET!)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

describe('Privy webhook route', () => {
  const repository = { findOne: mockFindOne, save: mockSave };
  const secretBefore = process.env.PRIVY_WEBHOOK_SECRET;

  beforeAll(() => {
    process.env.PRIVY_WEBHOOK_SECRET = 'test-webhook-secret';
    mockGetRepository.mockReturnValue(repository);
  });

  afterAll(() => {
    if (secretBefore === undefined) delete process.env.PRIVY_WEBHOOK_SECRET;
    else process.env.PRIVY_WEBHOOK_SECRET = secretBefore;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOne.mockResolvedValue(null);
    mockSave.mockResolvedValue(undefined);
    mockCreateUser.mockResolvedValue({ id: 'local-user' });
    const cache = new Map<string, string>();
    mockRedisSet.mockImplementation((key: string, value: string, ...options: string[]) => {
      if (options.includes('NX') && cache.has(key)) return Promise.resolve(null);
      cache.set(key, value);
      return Promise.resolve('OK');
    });
    mockRedisDel.mockImplementation((key: string) => Promise.resolve(cache.delete(key) ? 1 : 0));
  });

  it('accepts a valid signature and processes a known event once', async () => {
    const body = JSON.stringify({ type: 'user.created', data: { id: 'did:privy:123' } });

    const response = await request(app)
      .post('/api/webhooks/privy')
      .set('privy-signature', signatureFor(body))
      .set('content-type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(mockCreateUser).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing signature header', async () => {
    const response = await request(app)
      .post('/api/webhooks/privy')
      .set('content-type', 'application/json')
      .send('{"type":"user.created","data":{"id":"did:privy:123"}}');

    expect(response.status).toBe(401);
  });

  it('rejects a body tampered after its signature was computed', async () => {
    const signedBody = '{"type":"user.created","data":{"id":"did:privy:123"}}';
    const response = await request(app)
      .post('/api/webhooks/privy')
      .set('privy-signature', signatureFor(signedBody))
      .set('content-type', 'application/json')
      .send('{"type":"user.created","data":{"id":"did:privy:456"}}');

    expect(response.status).toBe(401);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('rejects signatures outside the timestamp tolerance window', async () => {
    const body = '{"type":"user.created","data":{"id":"did:privy:123"}}';
    const oldTimestamp = Math.floor(Date.now() / 1000) - 301;
    const response = await request(app)
      .post('/api/webhooks/privy')
      .set('privy-signature', signatureFor(body, oldTimestamp))
      .set('content-type', 'application/json')
      .send(body);

    expect(response.status).toBe(401);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('acknowledges and logs unknown event types', async () => {
    const warn = jest.spyOn(logger, 'warn');
    const body = '{"type":"user.future_event","data":{}}';
    const response = await request(app)
      .post('/api/webhooks/privy')
      .set('privy-signature', signatureFor(body))
      .set('content-type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'user.future_event' }),
      'Unknown Privy webhook event type',
    );
    warn.mockRestore();
  });

  it('verifies the raw JSON bytes instead of a re-serialized body', async () => {
    const body = '{\n  "type": "user.created",\n  "data": { "id": "did:privy:raw" }\n}';
    const response = await request(app)
      .post('/api/webhooks/privy')
      .set('privy-signature', signatureFor(body))
      .set('content-type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ privyUserId: 'did:privy:raw' }),
    );
  });

  it('processes a repeated webhook ID only once', async () => {
    const body = '{"type":"user.created","data":{"id":"did:privy:duplicate"}}';
    const send = () =>
      request(app)
        .post('/api/webhooks/privy')
        .set('privy-signature', signatureFor(body))
        .set('svix-id', 'webhook-123')
        .set('content-type', 'application/json')
        .send(body);

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect(mockCreateUser).toHaveBeenCalledTimes(1);
  });
});
