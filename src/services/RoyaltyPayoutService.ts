import { In, Repository } from "typeorm";
import AppDataSource from "../config/db";
import {
  RoyaltyPayout,
  RoyaltyPayoutStatus,
  RoyaltySplit,
} from "../entities/RoyaltyPayout";
import { SorobanContracts } from "../config/soroban";
import { SorobanService } from "./Soroban/SorobanService";

export interface CreateRoyaltyPayoutInput {
  saleEventId: string;
  saleTxHash?: string;
  songId?: string;
  tokenId?: string;
  buyerPublicKey?: string;
  sellerPublicKey?: string;
  artistId?: string;
  currency?: string;
  grossAmountStroops: string;
  expectedSplits: RoyaltySplit[];
}

export interface RoyaltyPayoutEvent {
  saleEventId: string;
  onChainEventId: string;
  recipientPublicKey: string;
  amountStroops: string;
}

export interface RoyaltyReconciliationResult {
  reconciled: RoyaltyPayout[];
  discrepancies: RoyaltyPayout[];
}

export class RoyaltyPayoutService {
  private royaltyPayoutRepo: Repository<RoyaltyPayout>;
  private soroban: SorobanService;

  constructor() {
    this.royaltyPayoutRepo = AppDataSource.getRepository(RoyaltyPayout);
    this.soroban = new SorobanService();
  }

  async recordExpectedPayout(input: CreateRoyaltyPayoutInput): Promise<RoyaltyPayout> {
    const payout = this.royaltyPayoutRepo.create({
      saleEventId: input.saleEventId,
      saleTxHash: input.saleTxHash,
      songId: input.songId,
      tokenId: input.tokenId,
      buyerPublicKey: input.buyerPublicKey,
      sellerPublicKey: input.sellerPublicKey,
      artist_id: input.artistId,
      currency: input.currency || "stroops",
      grossAmountStroops: input.grossAmountStroops,
      expectedSplits: input.expectedSplits,
      status: RoyaltyPayoutStatus.PENDING,
    });

    return this.royaltyPayoutRepo.save(payout);
  }

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
        actualAmountStroops: actualByRecipient.get(split.recipientPublicKey),
      }));

      const missingOrMismatched = splitResults.filter(
        (split) => split.actualAmountStroops !== split.expectedAmountStroops,
      );

      payout.expectedSplits = splitResults;
      payout.onChainEventId = eventId;
      payout.reconciledAt = new Date();

      if (missingOrMismatched.length > 0) {
        payout.status = RoyaltyPayoutStatus.DISCREPANCY;
        payout.discrepancyReason = missingOrMismatched
          .map((split) => {
            const actual = split.actualAmountStroops || "missing";
            return `${split.recipientPublicKey} expected ${split.expectedAmountStroops}, actual ${actual}`;
          })
          .join("; ");
        discrepancies.push(await this.royaltyPayoutRepo.save(payout));
      } else {
        payout.status = RoyaltyPayoutStatus.RECONCILED;
        payout.discrepancyReason = undefined;
        reconciled.push(await this.royaltyPayoutRepo.save(payout));
      }
    }

    return { reconciled, discrepancies };
  }

  async listDiscrepancies(): Promise<RoyaltyPayout[]> {
    return this.royaltyPayoutRepo.findBy({ status: RoyaltyPayoutStatus.DISCREPANCY });
  }

  private async fetchRoyaltyContractEvents(saleEventIds: string[]): Promise<RoyaltyPayoutEvent[]> {
    return this.soroban.getRoyaltyPayoutEvents(SorobanContracts.royalty, saleEventIds);
  }
}
