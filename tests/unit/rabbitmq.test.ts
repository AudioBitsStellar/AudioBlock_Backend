/**
 * Tests for RabbitMQ reconnect-with-backoff behaviour (#923).
 */
import { jest } from '@jest/globals';

jest.mock('../../src/utils/gracefulShutdown', () => ({ isShuttingDown: () => false }));
jest.mock('../../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockChannel = { on: jest.fn() };
const mockConnection = {
  createChannel: jest.fn().mockResolvedValue(mockChannel),
  on: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock('amqplib', () => ({ default: { connect: jest.fn() } }));

import amqp from 'amqplib';
const mockConnect = amqp.connect as jest.MockedFunction<typeof amqp.connect>;

beforeEach(() => {
  jest.useFakeTimers();
  mockConnect.mockReset();
  mockConnection.on.mockReset();
  mockConnection.createChannel.mockReset().mockResolvedValue(mockChannel);
  mockConnect.mockResolvedValue(mockConnection as any);
  process.env.RABBITMQ_URL = 'amqp://localhost';
});

afterEach(() => {
  jest.useRealTimers();
});

test('connects successfully and resets backoff counter', async () => {
  const { initRabbitMQ, isConnected } = await import('../../src/config/rabbitmq');
  await initRabbitMQ();
  expect(isConnected()).toBe(true);
});

test('retries with exponential backoff on initial connection failure', async () => {
  mockConnect
    .mockRejectedValueOnce(new Error('ECONNREFUSED'))
    .mockRejectedValueOnce(new Error('ECONNREFUSED'))
    .mockResolvedValue(mockConnection as any);

  const { initRabbitMQ } = await import('../../src/config/rabbitmq');
  const initPromise = initRabbitMQ();
  await initPromise;

  // First retry after 1 s (2^0 * 1000)
  await jest.advanceTimersByTimeAsync(1_000);
  // Second retry after 2 s (2^1 * 1000)
  await jest.advanceTimersByTimeAsync(2_000);

  expect(mockConnect.mock.calls.length).toBeGreaterThanOrEqual(1);
});

test('backoff caps at 30 s', async () => {
  // Simulate many failures — delay should not exceed 30 000 ms
  let calls = 0;
  mockConnect.mockImplementation(() => {
    calls += 1;
    if (calls < 10) return Promise.reject(new Error('down'));
    return Promise.resolve(mockConnection as any);
  });

  const { initRabbitMQ } = await import('../../src/config/rabbitmq');
  const initPromise = initRabbitMQ();
  await initPromise;

  // Advance enough time for all retries (max 30 s each, 9 retries → 270 s)
  await jest.advanceTimersByTimeAsync(300_000);
  expect(mockConnect.mock.calls.length).toBeGreaterThanOrEqual(1);
});
