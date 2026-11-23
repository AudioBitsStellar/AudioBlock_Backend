import 'reflect-metadata';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock('../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../config/soroban', () => ({ SorobanContracts: { royalty: 'royalty' } }));
jest.mock('../services/Soroban/SorobanService', () => ({ SorobanService: jest.fn() }));
jest.mock('../services/NotificationService', () => ({ NotificationService: jest.fn() }));
jest.mock('../services/MetricsService', () => ({ royaltiesPaidTotal: { inc: jest.fn() } }));

import AppDataSource from '../config/db';
import { PayoutEligibilityService } from '../services/PayoutEligibilityService';
import { RoyaltyPayoutService } from '../services/RoyaltyPayoutService';
import { NotificationService } from '../services/NotificationService';
import { RoyaltyPayout } from '../entities/RoyaltyPayout';
import { User } from '../entities/User';

const artistId = '44444444-4444-4444-8444-444444444444';

const mockUserRepo = { findOne: jest.fn() };
const mockPayoutRepo = {
  create: jest.fn((data) => data),
  save: jest.fn(async (data) => data),
  update: jest.fn(async () => ({ affected: 2 })),
};
const createNotification = jest.fn(async () => ({}));

const baseInput = {
  saleEventId: 'sale-1',
  grossAmount: '1000',
  expectedSplits: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
    if (entity === User) return mockUserRepo;
    if (entity === RoyaltyPayout) return mockPayoutRepo;
    return mockPayoutRepo;
  });
  (NotificationService as unknown as jest.Mock).mockImplementation(() => ({
    create: createNotification,
  }));
});

describe('PayoutEligibilityService (#979)', () => {
  it('reports an artist as verified only when the account is verified', async () => {
    mockUserRepo.findOne.mockResolvedValueOnce({ id: artistId, isVerified: true });
    await expect(PayoutEligibilityService.isArtistVerified(artistId)).resolves.toBe(true);

    mockUserRepo.findOne.mockResolvedValueOnce({ id: artistId, isVerified: false });
    await expect(PayoutEligibilityService.isArtistVerified(artistId)).resolves.toBe(false);

    mockUserRepo.findOne.mockResolvedValueOnce(null);
    await expect(PayoutEligibilityService.isArtistVerified(artistId)).resolves.toBe(false);
  });

  it('releases only the held payouts of the given artist and reports the count', async () => {
    const released = await PayoutEligibilityService.releaseHeldPayouts(artistId);

    expect(mockPayoutRepo.update).toHaveBeenCalledWith(
      { artist_id: artistId, heldUntilVerified: true },
      { heldUntilVerified: false },
    );
    expect(released).toBe(2);
  });
});

describe('RoyaltyPayoutService.recordExpectedPayout — verification gate (#979)', () => {
  it('holds a payout for an unverified artist and tells them it is on hold', async () => {
    mockUserRepo.findOne.mockResolvedValueOnce({ id: artistId, isVerified: false });
    const service = new RoyaltyPayoutService();

    const payout = await service.recordExpectedPayout({ ...baseInput, artistId });

    expect(payout.heldUntilVerified).toBe(true);
    expect(mockPayoutRepo.save).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Royalty payout on hold' }),
    );
  });

  it('records a payout as released for a verified artist', async () => {
    mockUserRepo.findOne.mockResolvedValueOnce({ id: artistId, isVerified: true });
    const service = new RoyaltyPayoutService();

    const payout = await service.recordExpectedPayout({ ...baseInput, artistId });

    expect(payout.heldUntilVerified).toBe(false);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Royalty payout recorded' }),
    );
  });

  it('does not look up or hold a payout that has no artist to verify', async () => {
    const service = new RoyaltyPayoutService();

    const payout = await service.recordExpectedPayout(baseInput);

    expect(mockUserRepo.findOne).not.toHaveBeenCalled();
    expect(payout.heldUntilVerified).toBe(false);
    expect(createNotification).not.toHaveBeenCalled();
  });
});
