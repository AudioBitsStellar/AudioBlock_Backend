import 'reflect-metadata';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn(), initialize: jest.fn(), destroy: jest.fn() },
}));
jest.mock('../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../config/soroban', () => ({ SorobanContracts: { royalty: 'royalty-contract' } }));
jest.mock('../services/Soroban/SorobanService', () => ({
  SorobanService: jest.fn().mockImplementation(() => ({
    getRoyaltyPayoutEvents: jest.fn(async () => []),
  })),
}));
jest.mock('../services/NotificationService', () => ({ NotificationService: jest.fn() }));
jest.mock('../services/MetricsService', () => ({ royaltiesPaidTotal: { inc: jest.fn() } }));
jest.mock('../services/Compliance/SanctionsScreeningService', () => ({
  SanctionsScreeningService: jest.fn().mockImplementation(() => ({
    assertRecipientsCleared: jest.fn(async () => undefined),
  })),
}));

import { In } from 'typeorm';
import AppDataSource from '../config/db';
import { RoyaltyPayout, RoyaltyPayoutStatus } from '../entities/RoyaltyPayout';
import type { RoyaltyPayoutEvent } from '../types';
import {
  RoyaltyPayoutDryRunService,
  buildRoyaltyPayoutDryRunReport,
  type DryRunPayout,
} from '../services/RoyaltyPayoutDryRunService';
import { RoyaltyPayoutService } from '../services/RoyaltyPayoutService';
import { toRoyaltyReconciliationReport } from '../services/RoyaltyReconciliationReport';
import { runRoyaltyPayoutDryRunJob } from '../jobs/RoyaltyPayoutDryRunJob';
import { runRoyaltyReconciliationJob } from '../jobs/RoyaltyReconciliationJob';

const RUN_AT = new Date('2026-11-23T10:00:00.000Z');

const payout = (
  saleEventId: string,
  grossAmount: string,
  splits: [string, string][],
  heldUntilVerified = false,
): DryRunPayout => ({
  saleEventId,
  grossAmount,
  status: RoyaltyPayoutStatus.PENDING,
  heldUntilVerified,
  expectedSplits: splits.map(([recipientPublicKey, expectedAmount]) => ({
    recipientPublicKey,
    expectedAmount,
  })),
});

const onChain = (
  saleEventId: string,
  recipientPublicKey: string,
  amountStroops: string,
): RoyaltyPayoutEvent => ({
  saleEventId,
  onChainEventId: `${saleEventId}-${recipientPublicKey}`,
  recipientPublicKey,
  amountStroops,
});

/**
 * sale-1 settled exactly, sale-2 never landed, sale-3 landed one stroop short.
 */
const ledger = [
  payout('sale-1', '1000', [
    ['GA', '600'],
    ['GB', '400'],
  ]),
  payout('sale-2', '2000', [['GA', '2000']], true),
  payout('sale-3', '3000', [['GC', '3000']]),
];

const chain = [
  onChain('sale-1', 'GA', '600'),
  onChain('sale-1', 'GB', '400'),
  // sale-2/GA never landed on-chain.
  onChain('sale-3', 'GC', '2999'),
];

describe('buildRoyaltyPayoutDryRunReport classification (#919)', () => {
  const report = buildRoyaltyPayoutDryRunReport(ledger, chain, 'dry-run', RUN_AT);

  it('counts payouts a reconciliation pass would move, without touching them', () => {
    expect(report.checked).toBe(3);
    expect(report.wouldReconcile).toBe(1);
    expect(report.wouldFlagDiscrepancy).toBe(2);
    expect(report.heldCount).toBe(1);
    expect(report.mode).toBe('dry-run');
  });

  it('separates a payout that never landed from one that landed short', () => {
    expect(report.discrepancies).toEqual([
      {
        saleEventId: 'sale-2',
        recipientPublicKey: 'GA',
        expectedAmount: '2000',
        actualAmount: null,
      },
      {
        saleEventId: 'sale-3',
        recipientPublicKey: 'GC',
        expectedAmount: '3000',
        actualAmount: '2999',
      },
    ]);
  });

  it('never marks itself as having written, and leaves its inputs alone', () => {
    const before = JSON.stringify(ledger);
    buildRoyaltyPayoutDryRunReport(ledger, chain, 'dry-run', RUN_AT);

    expect(report.written).toBe(false);
    expect(JSON.stringify(ledger)).toBe(before);
  });
});

describe('buildRoyaltyPayoutDryRunReport totals (#919)', () => {
  const report = buildRoyaltyPayoutDryRunReport(ledger, chain, 'dry-run', RUN_AT);

  it('aggregates what is owed per recipient across the whole batch', () => {
    expect(report.totalGrossStroops).toBe('6000');
    expect(report.expectedToPay).toEqual([
      { recipientPublicKey: 'GA', amountStroops: '2600' },
      { recipientPublicKey: 'GB', amountStroops: '400' },
      { recipientPublicKey: 'GC', amountStroops: '3000' },
    ]);
  });

  it('reports an empty ledger as nothing-to-do rather than an error', () => {
    expect(buildRoyaltyPayoutDryRunReport([], [], 'enabled', RUN_AT)).toMatchObject({
      checked: 0,
      wouldReconcile: 0,
      wouldFlagDiscrepancy: 0,
      discrepancies: [],
      totalGrossStroops: '0',
      expectedToPay: [],
      written: false,
    });
  });
});

describe('RoyaltyPayoutDryRunService (#919)', () => {
  const repo = {
    findBy: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (AppDataSource.getRepository as jest.Mock).mockReturnValue(repo);
  });

  it('reads the same pending + discrepancy set the reconciliation job would', async () => {
    repo.findBy.mockResolvedValue([]);

    await new RoyaltyPayoutDryRunService().generateReport();

    expect(repo.findBy).toHaveBeenCalledWith({
      status: In([RoyaltyPayoutStatus.PENDING, RoyaltyPayoutStatus.DISCREPANCY]),
    });
  });

  it('is incapable of writing to the payout ledger', async () => {
    repo.findBy.mockResolvedValue([
      { ...payout('sale-1', '1000', [['GA', '1000']]), id: 'p1' } as unknown as RoyaltyPayout,
    ]);

    const report = await new RoyaltyPayoutDryRunService().generateReport();

    expect(report.checked).toBe(1);
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });
});

describe('royalty payout jobs (#919)', () => {
  it('refuses to read the ledger while ROYALTY_PAYOUT_MODE=disabled', async () => {
    process.env.ROYALTY_PAYOUT_MODE = 'disabled';
    const generate = jest
      .spyOn(RoyaltyPayoutDryRunService.prototype, 'generateReport')
      .mockResolvedValue(null as never);

    await expect(runRoyaltyPayoutDryRunJob()).resolves.toBeNull();
    expect(generate).not.toHaveBeenCalled();

    generate.mockRestore();
    delete process.env.ROYALTY_PAYOUT_MODE;
  });

  it('returns the report it read when reporting is allowed', async () => {
    const expected = buildRoyaltyPayoutDryRunReport([], [], 'dry-run', RUN_AT);
    const generate = jest
      .spyOn(RoyaltyPayoutDryRunService.prototype, 'generateReport')
      .mockResolvedValue(expected);

    await expect(runRoyaltyPayoutDryRunJob()).resolves.toBe(expected);

    generate.mockRestore();
  });
});

/** sale-9: GA settled at 500, GB landed 240 against an expected 250. */
const shortChangedPayout = {
  ...payout('sale-9', '750', [
    ['GA', '500'],
    ['GB', '250'],
  ]),
  expectedSplits: [
    { recipientPublicKey: 'GA', expectedAmount: '500', shareBps: 5000, actualAmount: '500' },
    { recipientPublicKey: 'GB', expectedAmount: '250', shareBps: 2500, actualAmount: '240' },
  ],
};

describe('runRoyaltyReconciliationJob (#919)', () => {
  it('expresses a failing reconciliation as a report, not just a log line', async () => {
    const reconcile = jest
      .spyOn(RoyaltyPayoutService.prototype, 'reconcilePendingPayouts')
      .mockResolvedValue({
        reconciled: [payout('sale-1', '1000', []) as unknown as RoyaltyPayout],
        discrepancies: [shortChangedPayout as unknown as RoyaltyPayout],
      });

    const report = await runRoyaltyReconciliationJob();

    expect(report).toEqual({
      ranAt: expect.any(String),
      checked: 2,
      reconciled: 1,
      discrepancies: [
        {
          saleEventId: 'sale-9',
          recipientPublicKey: 'GB',
          expectedAmount: '250',
          actualAmount: '240',
        },
      ],
      passed: false,
    });

    reconcile.mockRestore();
  });
});

describe('toRoyaltyReconciliationReport (#919)', () => {
  it('passes a clean pass and a zero-payout pass', () => {
    const clean = toRoyaltyReconciliationReport({ reconciled: [], discrepancies: [] }, RUN_AT);

    expect(clean).toMatchObject({
      checked: 0,
      reconciled: 0,
      passed: true,
      ranAt: RUN_AT.toISOString(),
    });
  });
});
