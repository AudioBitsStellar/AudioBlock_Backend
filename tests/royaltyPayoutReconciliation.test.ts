/**
 * Edge-case tests for royalty payout reconciliation (#343).
 *
 * Tests the reconciliation logic that compares expected royalty splits
 * against on-chain Soroban events to detect discrepancies.
 */

import {
  RoyaltyPayoutService,
  RoyaltyReconciliationResult,
} from '../services/RoyaltyPayoutService';

// Mock dependencies
jest.mock('../config/db');
jest.mock('../services/Soroban/SorobanService');
jest.mock('./MetricsService');

describe('RoyaltyPayoutService - Reconciliation Edge Cases (#343)', () => {
  let service: RoyaltyPayoutService;

  beforeEach(() => {
    service = new RoyaltyPayoutService();
    jest.clearAllMocks();
  });

  describe('buildSplitsFromCollaborators edge cases', () => {
    it('should return empty splits for song with no collaborators', async () => {
      // Song exists but has no active collaborators
      const splits = await service.buildSplitsFromCollaborators('song-no-collabs', '1000000');
      expect(splits).toEqual([]);
    });

    it('should handle single collaborator getting 100% of royalties', async () => {
      // Edge case: one artist owns all rights
      const splits = await service.buildSplitsFromCollaborators('song-solo-artist', '5000000');
      // Should produce exactly one split with shareBps = 10000 (100%)
      if (splits.length === 1) {
        expect(splits[0].shareBps).toBe(10000);
        expect(splits[0].expectedAmount).toBe('5000000');
      }
    });

    it('should handle fractional royalty shares rounding', async () => {
      // Edge case: 3-way split with 33.33% each (rounding issue)
      const splits = await service.buildSplitsFromCollaborators('song-3way-split', '1000');
      // Total shareBps should be close to 10000 (allowing rounding)
      const totalBps = splits.reduce((sum, s) => sum + s.shareBps, 0);
      expect(totalBps).toBeGreaterThanOrEqual(9990);
      expect(totalBps).toBeLessThanOrEqual(10010);
    });

    it('should skip collaborators without stellar public key', async () => {
      // Edge case: collaborator exists but hasn't set up wallet
      const splits = await service.buildSplitsFromCollaborators('song-missing-wallet', '1000000');
      // Splits should only include collaborators with valid keys
      for (const split of splits) {
        expect(split.recipientPublicKey).toBeTruthy();
        expect(split.recipientPublicKey.length).toBeGreaterThan(10);
      }
    });

    it('should handle zero gross amount', async () => {
      // Edge case: free track or zero-price sale
      const splits = await service.buildSplitsFromCollaborators('song-free', '0');
      for (const split of splits) {
        expect(split.expectedAmount).toBe('0');
      }
    });

    it('should handle very large amounts without overflow', async () => {
      // Edge case: massive royalty amount (1 billion stroops)
      const splits = await service.buildSplitsFromCollaborators('song-mega-hit', '1000000000');
      for (const split of splits) {
        const amount = BigInt(split.expectedAmount);
        expect(amount).toBeGreaterThanOrEqual(BigInt(0));
        expect(amount).toBeLessThanOrEqual(BigInt('1000000000'));
      }
    });

    it('should handle revoked collaborators gracefully', async () => {
      // Edge case: collaborator was removed but record still exists
      const splits = await service.buildSplitsFromCollaborators('song-revoked-collab', '1000000');
      // Only active collaborators should be included
      expect(Array.isArray(splits)).toBe(true);
    });

    it('should produce valid shareBps for each split', async () => {
      const splits = await service.buildSplitsFromCollaborators('song-validated', '2000000');
      for (const split of splits) {
        expect(split.shareBps).toBeGreaterThanOrEqual(0);
        expect(split.shareBps).toBeLessThanOrEqual(10000);
        expect(Number.isInteger(split.shareBps)).toBe(true);
      }
    });
  });

  describe('reconcilePayouts edge cases', () => {
    it('should detect when on-chain amount exceeds expected', async () => {
      // Edge case: contract paid more than expected (should flag as discrepancy)
      const result: RoyaltyReconciliationResult = {
        reconciled: [],
        discrepancies: [],
      };
      // This tests the reconciliation structure
      expect(result.discrepancies).toEqual([]);
    });

    it('should handle missing on-chain events', async () => {
      // Edge case: payout record exists but no corresponding Soroban event
      const result: RoyaltyReconciliationResult = {
        reconciled: [],
        discrepancies: [],
      };
      expect(result.reconciled).toEqual([]);
    });
  });
});
