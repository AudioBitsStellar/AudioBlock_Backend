import 'reflect-metadata';

const mockAssertRecipientsCleared = jest.fn();

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../config/soroban', () => ({
  SorobanContracts: { royalty: 'CROYALTY' },
}));
jest.mock('../Soroban/SorobanService', () => ({
  SorobanService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../NotificationService', () => ({
  NotificationService: jest.fn().mockImplementation(() => ({ create: jest.fn() })),
}));
jest.mock('../MetricsService', () => ({
  royaltiesPaidTotal: { inc: jest.fn() },
}));
jest.mock('../Compliance/SanctionsScreeningService', () => ({
  SanctionsScreeningService: jest.fn().mockImplementation(() => ({
    assertRecipientsCleared: (...args: unknown[]) => mockAssertRecipientsCleared(...args),
  })),
}));

import AppDataSource from '../../config/db';
import { AppError } from '../../errors/AppError';
import { RoyaltyPayoutService } from '../RoyaltyPayoutService';

const INPUT = {
  saleEventId: 'sale-1',
  grossAmount: '1000',
  expectedSplits: [{ recipientPublicKey: 'GARTIST', shareBps: 10000, expectedAmount: '1000' }],
};

describe('RoyaltyPayoutService.recordExpectedPayout compliance gate (#985)', () => {
  let mockRoyaltyRepo: { create: jest.Mock; save: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRoyaltyRepo = {
      create: jest.fn((data) => ({ ...data })),
      save: jest.fn(async (payout) => payout),
    };
    (AppDataSource.getRepository as jest.Mock).mockImplementation(() => mockRoyaltyRepo);
  });

  it('screens every split recipient before recording the payout', async () => {
    mockAssertRecipientsCleared.mockResolvedValue(undefined);

    await new RoyaltyPayoutService().recordExpectedPayout(INPUT);

    expect(mockAssertRecipientsCleared).toHaveBeenCalledWith(['GARTIST']);
    expect(mockRoyaltyRepo.save).toHaveBeenCalledTimes(1);
  });

  it('records nothing when a recipient is blocked', async () => {
    const blocked = AppError.authorization(
      'Payout blocked by compliance hold',
      [{ recipientPublicKey: 'GARTIST', reason: 'payout_hold' }],
      'PAYOUT_BLOCKED',
    );
    mockAssertRecipientsCleared.mockRejectedValue(blocked);

    await expect(new RoyaltyPayoutService().recordExpectedPayout(INPUT)).rejects.toBe(blocked);
    expect(mockRoyaltyRepo.create).not.toHaveBeenCalled();
    expect(mockRoyaltyRepo.save).not.toHaveBeenCalled();
  });
});
