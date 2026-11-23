import 'reflect-metadata';

const mockCreateLogEntry = jest.fn();

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../TransactionLogService', () => ({
  TransactionLogService: jest.fn().mockImplementation(() => ({
    createLogEntry: (...args: unknown[]) => mockCreateLogEntry(...args),
  })),
}));

import AppDataSource from '../../config/db';
import { AppError } from '../../errors/AppError';
import {
  PAYOUT_BLOCKED_CODE,
  PAYOUT_HOLD_CLEARED_ACTION,
  PAYOUT_HOLD_PLACED_ACTION,
  SANCTIONS_MATCH_HOLD_REASON,
  SCREENING_UNAVAILABLE_CODE,
  SanctionsScreeningService,
} from '../Compliance/SanctionsScreeningService';
import {
  DenylistScreeningProvider,
  createScreeningProviderFromEnv,
} from '../Compliance/sanctionsProviders';

const DENIED_KEY = 'GDENIED';
const CLEAN_KEY = 'GCLEAN';

describe('DenylistScreeningProvider (#985)', () => {
  it('matches only keys on the denylist', async () => {
    const provider = new DenylistScreeningProvider([' GDENIED ', '', 'GOTHER']);

    await expect(provider.screen({ stellarPublicKey: 'GDENIED' })).resolves.toEqual({
      status: 'match',
      reference: 'denylist',
    });
    await expect(provider.screen({ stellarPublicKey: CLEAN_KEY })).resolves.toEqual({
      status: 'clear',
    });
  });

  it('rejects an unsupported provider name rather than skipping screening', () => {
    expect(() =>
      createScreeningProviderFromEnv({ SANCTIONS_SCREENING_PROVIDER: 'none' } as NodeJS.ProcessEnv),
    ).toThrow('Unsupported SANCTIONS_SCREENING_PROVIDER: none');
  });
});

describe('SanctionsScreeningService (#985)', () => {
  let mockUserRepo: { findBy: jest.Mock; findOneBy: jest.Mock; update: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SANCTIONS_DENYLIST = DENIED_KEY;
    delete process.env.SANCTIONS_SCREENING_PROVIDER;

    mockUserRepo = {
      findBy: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    };
    (AppDataSource.getRepository as jest.Mock).mockImplementation(() => mockUserRepo);
  });

  afterEach(() => {
    delete process.env.SANCTIONS_DENYLIST;
    delete process.env.SANCTIONS_SCREENING_PROVIDER;
  });

  describe('assertRecipientsCleared', () => {
    it('does nothing for an empty recipient list', async () => {
      await new SanctionsScreeningService().assertRecipientsCleared([]);

      expect(mockUserRepo.findBy).not.toHaveBeenCalled();
    });

    it('allows recipients that are clear and not on hold', async () => {
      mockUserRepo.findBy.mockResolvedValue([
        { id: 'u1', stellarPublicKey: CLEAN_KEY, payoutHoldReason: null },
      ]);

      await expect(
        new SanctionsScreeningService().assertRecipientsCleared([CLEAN_KEY]),
      ).resolves.toBeUndefined();
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it('blocks an account already under a payout hold without screening it again', async () => {
      mockUserRepo.findBy.mockResolvedValue([
        { id: 'u1', stellarPublicKey: CLEAN_KEY, payoutHoldReason: 'manual_hold' },
      ]);

      const error = await new SanctionsScreeningService()
        .assertRecipientsCleared([CLEAN_KEY])
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(PAYOUT_BLOCKED_CODE);
      expect((error as AppError).details).toEqual([
        { recipientPublicKey: CLEAN_KEY, reason: 'payout_hold' },
      ]);
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it('places a hold on a sanctions match and blocks the payout', async () => {
      mockUserRepo.findBy.mockResolvedValue([
        { id: 'u2', stellarPublicKey: DENIED_KEY, payoutHoldReason: null },
      ]);

      const error = await new SanctionsScreeningService()
        .assertRecipientsCleared([DENIED_KEY])
        .catch((e: unknown) => e);

      expect((error as AppError).code).toBe(PAYOUT_BLOCKED_CODE);
      expect((error as AppError).details).toEqual([
        { recipientPublicKey: DENIED_KEY, reason: SANCTIONS_MATCH_HOLD_REASON },
      ]);
      expect(mockUserRepo.update).toHaveBeenCalledWith(
        { id: 'u2' },
        expect.objectContaining({
          payoutHoldReason: SANCTIONS_MATCH_HOLD_REASON,
          payoutHoldPlacedAt: expect.any(Date),
        }),
      );
      expect(mockCreateLogEntry).toHaveBeenCalledWith(
        'u2',
        '',
        PAYOUT_HOLD_PLACED_ACTION,
        expect.stringContaining(SANCTIONS_MATCH_HOLD_REASON),
      );
    });

    it('blocks a sanctions match with no local account, which has nothing to hold', async () => {
      const error = await new SanctionsScreeningService()
        .assertRecipientsCleared([DENIED_KEY])
        .catch((e: unknown) => e);

      expect((error as AppError).code).toBe(PAYOUT_BLOCKED_CODE);
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it('fails closed when the screening provider cannot be built', async () => {
      process.env.SANCTIONS_SCREENING_PROVIDER = 'unknown-vendor';

      const error = await new SanctionsScreeningService()
        .assertRecipientsCleared([CLEAN_KEY])
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(SCREENING_UNAVAILABLE_CODE);
      expect((error as AppError).statusCode).toBe(502);
    });
  });

  describe('setPayoutHold (admin action)', () => {
    it('returns 404 when the account does not exist', async () => {
      mockUserRepo.findOneBy.mockResolvedValue(null);

      await expect(
        new SanctionsScreeningService().setPayoutHold('missing', true, 'x', 'admin-1'),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it('places a hold with a trimmed reason and audits it under the admin', async () => {
      mockUserRepo.findOneBy.mockResolvedValue({ id: 'u1' });

      const state = await new SanctionsScreeningService().setPayoutHold(
        'u1',
        true,
        '  Court order 42  ',
        'admin-1',
      );

      expect(mockUserRepo.update).toHaveBeenCalledWith(
        { id: 'u1' },
        { payoutHoldReason: 'Court order 42', payoutHoldPlacedAt: expect.any(Date) },
      );
      expect(state).toEqual({
        active: true,
        reason: 'Court order 42',
        placedAt: expect.any(Date),
      });
      expect(mockCreateLogEntry).toHaveBeenCalledWith(
        'admin-1',
        '',
        PAYOUT_HOLD_PLACED_ACTION,
        'target=u1 reason=Court order 42',
      );
    });

    it('uses a default reason when an admin places a hold without one', async () => {
      mockUserRepo.findOneBy.mockResolvedValue({ id: 'u1' });

      const state = await new SanctionsScreeningService().setPayoutHold(
        'u1',
        true,
        undefined,
        'admin-1',
      );

      expect(state.reason).toBe('manual_hold');
    });

    it('clears a hold and audits the release', async () => {
      mockUserRepo.findOneBy.mockResolvedValue({ id: 'u1' });

      const state = await new SanctionsScreeningService().setPayoutHold(
        'u1',
        false,
        'reviewed',
        'admin-1',
      );

      expect(mockUserRepo.update).toHaveBeenCalledWith(
        { id: 'u1' },
        { payoutHoldReason: null, payoutHoldPlacedAt: null },
      );
      expect(state).toEqual({ active: false, reason: null, placedAt: null });
      expect(mockCreateLogEntry).toHaveBeenCalledWith(
        'admin-1',
        '',
        PAYOUT_HOLD_CLEARED_ACTION,
        'target=u1 reason=reviewed',
      );
    });
  });
});
