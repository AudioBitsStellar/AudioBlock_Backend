/**
 * Global Jest teardown hook (Issue #834).
 * Ensures in-memory timers and shared Redis/DB handles are cleanly terminated
 * after each test file completes so worker processes exit immediately without
 * leaking open handles.
 */
afterAll(async () => {
  try {
    const privyPath = require.resolve('../../src/services/privy/PrivySessionService');
    if (require.cache[privyPath]) {
      require('../../src/services/privy/PrivySessionService').privySessionService?.stop?.();
    }
  } catch {}

  try {
    const poolPath = require.resolve('../../src/services/DbPoolMonitor');
    if (require.cache[poolPath]) {
      require('../../src/services/DbPoolMonitor').stopDbPoolMonitor?.();
    }
  } catch {}

  try {
    const dbConnPath = require.resolve('../../src/services/DatabaseConnectionManager');
    if (require.cache[dbConnPath]) {
      require('../../src/services/DatabaseConnectionManager').stopConnectionStateLogger?.();
    }
  } catch {}

  try {
    const workerPath = require.resolve('../../src/workers/JobQueueWorker');
    if (require.cache[workerPath]) {
      require('../../src/workers/JobQueueWorker').stopJobQueueMonitor?.();
    }
  } catch {}

  try {
    const redisPath = require.resolve('../../src/config/redis');
    if (require.cache[redisPath]) {
      const redisModule = require('../../src/config/redis');
      const redisInstance = redisModule.default || redisModule;
      if (redisInstance && typeof redisInstance.disconnect === 'function') {
        redisInstance.disconnect(false);
      }
    }
  } catch {}
});
