jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { isInitialized: false, destroy: jest.fn() },
}));

jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: { quit: jest.fn() },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import AppDataSource from '../../config/db';
import redis from '../../config/redis';
import {
  closeDatabase,
  closeRedis,
  registerShutdownHook,
  isShuttingDown,
  registerServer,
  drainWorkerQueues,
} from '../gracefulShutdown';

const mockDataSource = AppDataSource as jest.Mocked<typeof AppDataSource>;
const mockRedis = redis as jest.Mocked<typeof redis>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('closeDatabase', () => {
  it('destroys the pool when initialized', async () => {
    (mockDataSource as any).isInitialized = true;
    (mockDataSource.destroy as jest.Mock).mockResolvedValue(undefined);

    await closeDatabase();

    expect(mockDataSource.destroy).toHaveBeenCalledTimes(1);
  });

  it('does nothing when pool is not initialized', async () => {
    (mockDataSource as any).isInitialized = false;

    await closeDatabase();

    expect(mockDataSource.destroy).not.toHaveBeenCalled();
  });
});

describe('closeRedis', () => {
  it('calls redis.quit()', async () => {
    (mockRedis.quit as jest.Mock).mockResolvedValue('OK');

    await closeRedis();

    expect(mockRedis.quit).toHaveBeenCalledTimes(1);
  });

  it('handles a quit() rejection without throwing', async () => {
    (mockRedis.quit as jest.Mock).mockRejectedValue(new Error('Redis gone'));

    await expect(closeRedis()).resolves.toBeUndefined();
  });
});

describe('registerShutdownHook', () => {
  it('registers a hook without throwing', () => {
    expect(() =>
      registerShutdownHook('test-hook', async () => {}),
    ).not.toThrow();
  });
});

describe('registerServer', () => {
  it('registers a server without throwing', () => {
    const fakeServer = {} as any;
    expect(() => registerServer(fakeServer)).not.toThrow();
  });
});

describe('isShuttingDown', () => {
  it('returns a boolean', () => {
    expect(typeof isShuttingDown()).toBe('boolean');
  });
});

describe('drainWorkerQueues', () => {
  it('resolves without throwing', async () => {
    await expect(drainWorkerQueues()).resolves.toBeUndefined();
  });
});
