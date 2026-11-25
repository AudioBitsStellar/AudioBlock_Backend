import {
  evaluatePayoutEnablement,
  getRoyaltyPayoutMode,
  isRoyaltyPayoutReportingAllowed,
} from '../royaltyPayoutMode';
import type { RoyaltyReconciliationReport } from '../../types';

const passing: RoyaltyReconciliationReport = {
  ranAt: '2026-11-23T00:00:00.000Z',
  checked: 4,
  reconciled: 4,
  discrepancies: [],
  passed: true,
};

const failing: RoyaltyReconciliationReport = {
  ranAt: '2026-11-23T00:00:00.000Z',
  checked: 4,
  reconciled: 2,
  discrepancies: [
    {
      saleEventId: 'sale-1',
      recipientPublicKey: 'GABC',
      expectedAmount: '500',
      actualAmount: null,
    },
    {
      saleEventId: 'sale-2',
      recipientPublicKey: 'GDEF',
      expectedAmount: '700',
      actualAmount: '699',
    },
  ],
  passed: false,
};

const originalMode = process.env.ROYALTY_PAYOUT_MODE;
afterEach(() => {
  if (originalMode === undefined) delete process.env.ROYALTY_PAYOUT_MODE;
  else process.env.ROYALTY_PAYOUT_MODE = originalMode;
});

describe('ROYALTY_PAYOUT_MODE parsing (#919)', () => {
  it('fails to dry-run when the variable is absent, blank, or unrecognised', () => {
    delete process.env.ROYALTY_PAYOUT_MODE;
    expect(getRoyaltyPayoutMode()).toBe('dry-run');

    process.env.ROYALTY_PAYOUT_MODE = '   ';
    expect(getRoyaltyPayoutMode()).toBe('dry-run');

    process.env.ROYALTY_PAYOUT_MODE = 'plz-send-money';
    expect(getRoyaltyPayoutMode()).toBe('dry-run');
  });

  it('normalises case and surrounding whitespace', () => {
    process.env.ROYALTY_PAYOUT_MODE = ' ENABLED ';
    expect(getRoyaltyPayoutMode()).toBe('enabled');
  });

  it('accepts each documented mode', () => {
    for (const mode of ['disabled', 'dry-run', 'enabled'] as const) {
      process.env.ROYALTY_PAYOUT_MODE = mode;
      expect(getRoyaltyPayoutMode()).toBe(mode);
    }
  });

  it('refuses reporting only in disabled mode', () => {
    process.env.ROYALTY_PAYOUT_MODE = 'disabled';
    expect(isRoyaltyPayoutReportingAllowed()).toBe(false);

    process.env.ROYALTY_PAYOUT_MODE = 'dry-run';
    expect(isRoyaltyPayoutReportingAllowed()).toBe(true);

    process.env.ROYALTY_PAYOUT_MODE = 'enabled';
    expect(isRoyaltyPayoutReportingAllowed()).toBe(true);
  });
});

describe('evaluatePayoutEnablement (#919)', () => {
  it('never arms below enabled, even on a passing reconciliation', () => {
    for (const mode of ['disabled', 'dry-run'] as const) {
      const verdict = evaluatePayoutEnablement(passing, mode);
      expect(verdict.armed).toBe(false);
      expect(verdict.reasons).toHaveLength(1);
    }
  });

  it('refuses to arm without a reconciliation report', () => {
    const verdict = evaluatePayoutEnablement(null, 'enabled');

    expect(verdict.armed).toBe(false);
    expect(verdict.reasons[0]).toContain('reconcile:royalties');
  });

  it('refuses to arm when the reconciliation pass reported discrepancies', () => {
    const verdict = evaluatePayoutEnablement(failing, 'enabled');

    expect(verdict.armed).toBe(false);
    expect(verdict.reasons[0]).toContain('2 recipient-level discrepancy');
  });

  it('arms only on enabled plus a passing report, with no reasons left over', () => {
    const verdict = evaluatePayoutEnablement(passing, 'enabled');

    expect(verdict).toEqual({ armed: true, reasons: [] });
  });

  it('reads the mode from the environment when none is supplied', () => {
    process.env.ROYALTY_PAYOUT_MODE = 'enabled';
    expect(evaluatePayoutEnablement(null).armed).toBe(false);

    process.env.ROYALTY_PAYOUT_MODE = 'enabled';
    expect(evaluatePayoutEnablement(passing).armed).toBe(true);
  });
});
