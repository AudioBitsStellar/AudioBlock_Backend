import 'reflect-metadata';

// ── shared DB mock ────────────────────────────────────────────────────────────
jest.mock('../../src/config/db', () => ({
  __esModule: true,
  default: {
    isInitialized: true,
    initialize: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../src/config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ── AccountDeletionJob ────────────────────────────────────────────────────────
const mockProcessDueDeletions = jest.fn();
jest.mock('../../src/services/AccountDeletionService', () => ({
  AccountDeletionService: jest.fn().mockImplementation(() => ({
    processDueDeletions: mockProcessDueDeletions,
  })),
}));

import { runAccountDeletionJob } from '../../src/jobs/AccountDeletionJob';

describe('runAccountDeletionJob (Issue #784)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns outcomes from the service', async () => {
    mockProcessDueDeletions.mockResolvedValue([
      { userId: 'u1', ok: true },
      { userId: 'u2', ok: true },
    ]);
    const result = await runAccountDeletionJob();
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ userId: 'u1', ok: true });
  });

  it('forwards the limit argument to the service', async () => {
    mockProcessDueDeletions.mockResolvedValue([]);
    await runAccountDeletionJob(5);
    expect(mockProcessDueDeletions).toHaveBeenCalledWith(5);
  });

  it('still returns outcomes when some erasures fail', async () => {
    mockProcessDueDeletions.mockResolvedValue([
      { userId: 'u1', ok: true },
      { userId: 'u2', ok: false, error: 'DB error' },
    ]);
    const result = await runAccountDeletionJob();
    expect(result.filter((r) => !r.ok)).toHaveLength(1);
  });

  it('returns an empty array when no deletions are due', async () => {
    mockProcessDueDeletions.mockResolvedValue([]);
    const result = await runAccountDeletionJob();
    expect(result).toEqual([]);
  });
});

// ── WebhookRetentionJob ───────────────────────────────────────────────────────
const mockCleanupOldDeliveries = jest.fn();
jest.mock('../../src/services/WebhookService', () => ({
  WebhookService: jest.fn().mockImplementation(() => ({
    cleanupOldDeliveries: mockCleanupOldDeliveries,
  })),
}));

import { runWebhookRetentionJob } from '../../src/jobs/WebhookRetentionJob';

describe('runWebhookRetentionJob (Issue #784)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the deleted count from the service', async () => {
    mockCleanupOldDeliveries.mockResolvedValue(42);
    const count = await runWebhookRetentionJob();
    expect(count).toBe(42);
  });

  it('defaults to 30 days when no argument is passed', async () => {
    mockCleanupOldDeliveries.mockResolvedValue(0);
    await runWebhookRetentionJob();
    expect(mockCleanupOldDeliveries).toHaveBeenCalledWith(30);
  });

  it('forwards a custom retention window', async () => {
    mockCleanupOldDeliveries.mockResolvedValue(7);
    await runWebhookRetentionJob(7);
    expect(mockCleanupOldDeliveries).toHaveBeenCalledWith(7);
  });

  it('returns 0 when nothing was deleted', async () => {
    mockCleanupOldDeliveries.mockResolvedValue(0);
    expect(await runWebhookRetentionJob()).toBe(0);
  });
});
