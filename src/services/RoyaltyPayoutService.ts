import { In, Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { RoyaltyPayout, RoyaltyPayoutStatus, RoyaltySplit } from '../entities/RoyaltyPayout';
import { SongCollaborator, CollaboratorStatus } from '../entities/SongCollaborator';
import { User } from '../entities/User';
import { SorobanContracts } from '../config/soroban';
import { SorobanService } from './Soroban/SorobanService';
import { royaltiesPaidTotal } from './MetricsService';
import { RoyaltyPayoutEvent } from '../types';
import { NotificationService } from './NotificationService';
import logger from '../config/logger';

export interface CreateRoyaltyPayoutInput {
  saleEventId: string;
  saleTxHash?: string;
  songId?: string;
  tokenId?: string;
  buyerPublicKey?: string;
  sellerPublicKey?: string;
  artistId?: string;
  currency?: string;
  grossAmount: string;
  expectedSplits: RoyaltySplit[];
}

export interface RoyaltyReconciliationResult {
  reconciled: RoyaltyPayout[];
  discrepancies: RoyaltyPayout[];
}

/**
 * Manages royalty payout records and reconciliation against on-chain events
 * from the Soroban royalty contract.
 */
export class RoyaltyPayoutService {
  private royaltyPayoutRepo: Repository<RoyaltyPayout>;
  private soroban: SorobanService;

  constructor() {
    this.royaltyPayoutRepo = AppDataSource.getRepository(RoyaltyPayout);
    this.soroban = new SorobanService();
  }

  /**
   * Build expected royalty splits for a sale from a song's active
   * SongCollaborator records (Issue #96), converting each collaborator's
   * royaltyShare percentage into stroop amounts and basis points.
   *
   * @param songId - Song whose active collaborators define the splits.
   * @param grossAmountStroops - Total sale amount to split among collaborators.
   * @returns RoyaltySplit entries, or [] if the song has no collaborators.
   */
  async buildSplitsFromCollaborators(songId: string, grossAmount: string): Promise<RoyaltySplit[]> {
    const collaboratorRepo = AppDataSource.getRepository(SongCollaborator);
    const userRepo = AppDataSource.getRepository(User);

    const collaborators = await collaboratorRepo.find({
      where: { songId, status: CollaboratorStatus.ACTIVE },
    });
    if (collaborators.length === 0) return [];

    const users = await userRepo.findBy({ id: In(collaborators.map((c) => c.userId)) });
    const userById = new Map(users.map((u) => [u.id, u]));
    const gross = BigInt(grossAmount);

    return collaborators
      .filter((c) => userById.get(c.userId)?.stellarPublicKey)
      .map((c) => {
        const shareBps = Math.round(c.royaltyShare * 100);
        const expectedAmount = (gross * BigInt(shareBps)) / BigInt(10000);
        return {
          recipientPublicKey: userById.get(c.userId)!.stellarPublicKey!,
          shareBps,
          expectedAmount: expectedAmount.toString(),
        };
      });
  }

  /**
   * Record an expected royalty payout from a marketplace sale. Creates a
   * pending payout record with the expected split amounts.
   *
   * @param input - Payout details including sale event ID, split recipients, and amounts.
   * @returns The persisted RoyaltyPayout entity with status PENDING.
   */
  async recordExpectedPayout(input: CreateRoyaltyPayoutInput): Promise<RoyaltyPayout> {
    const payout = this.royaltyPayoutRepo.create({
      saleEventId: input.saleEventId,
      saleTxHash: input.saleTxHash,
      songId: input.songId,
      tokenId: input.tokenId,
      buyerPublicKey: input.buyerPublicKey,
      sellerPublicKey: input.sellerPublicKey,
      artist_id: input.artistId,
      currency: input.currency || 'stroops',
      grossAmount: input.grossAmount,
      expectedSplits: input.expectedSplits,
      status: RoyaltyPayoutStatus.PENDING,
    });

    await this.royaltyPayoutRepo.save(payout);
    royaltiesPaidTotal.inc();

    // Notify the artist about the payout (Issue #79). Best-effort: a
    // notification failure must never break the payout recording itself.
    if (input.artistId) {
      try {
        await new NotificationService().create({
          userId: input.artistId,
          type: 'royalty_payout',
          title: 'Royalty payout recorded',
          message: `A royalty payout of ${input.grossAmount} ${
            input.currency || 'stroops'
          } was recorded for your music.`,
          data: { saleEventId: input.saleEventId, songId: input.songId },
        });
      } catch (err) {
        logger.warn(
          { err, artistId: input.artistId },
          'Failed to create royalty payout notification',
        );
      }
    }

    return payout;
  }

  /**
   * Fetch pending/discrepancy payouts and reconcile them against on-chain
   * royalty contract events. Marks each as RECONCILED or DISCREPANCY.
   *
   * @returns Reconciled and discrepant payout records.
   */
  async reconcilePendingPayouts(): Promise<RoyaltyReconciliationResult> {
    const pending = await this.royaltyPayoutRepo.findBy({
      status: In([RoyaltyPayoutStatus.PENDING, RoyaltyPayoutStatus.DISCREPANCY]),
    });

    if (pending.length === 0) {
      return { reconciled: [], discrepancies: [] };
    }

    const events = await this.fetchRoyaltyContractEvents(
      pending.map((payout) => payout.saleEventId),
    );

    return this.reconcileEvents(events);
  }

  /**
   * Reconcile a set of on-chain royalty payout events against stored payout
   * records. Compares expected vs actual amounts per recipient.
   *
   * @param events - Array of RoyaltyPayoutEvent from the Soroban RPC.
   * @returns Reconciled and discrepant payout records.
   */
  async reconcileEvents(events: RoyaltyPayoutEvent[]): Promise<RoyaltyReconciliationResult> {
    const saleEventIds = [...new Set(events.map((event) => event.saleEventId))];
    if (saleEventIds.length === 0) {
      return { reconciled: [], discrepancies: [] };
    }

    const payouts = await this.royaltyPayoutRepo.findBy({ saleEventId: In(saleEventIds) });
    const reconciled: RoyaltyPayout[] = [];
    const discrepancies: RoyaltyPayout[] = [];

    for (const payout of payouts) {
      const saleEvents = events.filter((event) => event.saleEventId === payout.saleEventId);
      const eventId = saleEvents[0]?.onChainEventId;
      const actualByRecipient = new Map(
        saleEvents.map((event) => [event.recipientPublicKey, event.amountStroops]),
      );

      const splitResults = payout.expectedSplits.map((split) => ({
        ...split,
        actualAmount: actualByRecipient.get(split.recipientPublicKey),
      }));

      const missingOrMismatched = splitResults.filter(
        (split) => split.actualAmount !== split.expectedAmount,
      );

      payout.expectedSplits = splitResults;
      payout.onChainEventId = eventId;
      payout.reconciledAt = new Date();

      if (missingOrMismatched.length > 0) {
        payout.status = RoyaltyPayoutStatus.DISCREPANCY;
        payout.discrepancyReason = missingOrMismatched
          .map((split) => {
            const actual = split.actualAmount || 'missing';
            return `${split.recipientPublicKey} expected ${split.expectedAmount}, actual ${actual}`;
          })
          .join('; ');
        discrepancies.push(await this.royaltyPayoutRepo.save(payout));
      } else {
        payout.status = RoyaltyPayoutStatus.RECONCILED;
        payout.discrepancyReason = undefined;
        reconciled.push(await this.royaltyPayoutRepo.save(payout));
      }
    }

    return { reconciled, discrepancies };
  }

  /**
   * List all payout records with DISCREPANCY status for investigation.
   *
   * @returns Array of RoyaltyPayout entities with discrepancy status.
   */
  async listDiscrepancies(): Promise<RoyaltyPayout[]> {
    return this.royaltyPayoutRepo.findBy({ status: RoyaltyPayoutStatus.DISCREPANCY });
  }

  private async fetchRoyaltyContractEvents(saleEventIds: string[]): Promise<RoyaltyPayoutEvent[]> {
    return this.soroban.getRoyaltyPayoutEvents(SorobanContracts.royalty, saleEventIds);
  }

  /**
   * Export royalty payout history for a specific artist to CSV format.
   *
   * @param artistId - The UUID of the artist.
   * @returns A CSV formatted string.
   */
  async exportHistory(artistId: string): Promise<string> {
    const payouts = await this.royaltyPayoutRepo.find({
      where: { artist_id: artistId },
      order: { createdAt: 'DESC' },
    });

    if (payouts.length === 0) {
      return 'ID,SaleEventId,Status,Currency,GrossAmount,CreatedAt\n';
    }

    const headers = ['ID', 'SaleEventId', 'Status', 'Currency', 'GrossAmount', 'CreatedAt'];
    const rows = payouts.map((p) =>
      [p.id, p.saleEventId, p.status, p.currency, p.grossAmount, p.createdAt.toISOString()].join(
        ',',
      ),
    );

    return [headers.join(','), ...rows].join('\n');
  }
}
