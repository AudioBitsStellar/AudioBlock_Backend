import { In, Repository } from 'typeorm';
import AppDataSource from '../../config/db';
import logger from '../../config/logger';
import { User } from '../../entities/User';
import { AppError } from '../../errors/AppError';
import { TransactionLogService } from '../TransactionLogService';
import {
  SanctionsScreeningProvider,
  ScreeningOutcome,
  createScreeningProviderFromEnv,
} from './sanctionsProviders';

/** Error code returned to the payout caller when a recipient is blocked. */
export const PAYOUT_BLOCKED_CODE = 'PAYOUT_BLOCKED';
/** Error code returned when screening cannot complete. Payouts fail closed on it. */
export const SCREENING_UNAVAILABLE_CODE = 'SCREENING_UNAVAILABLE';
/** Hold reason written when screening matches a recipient. */
export const SANCTIONS_MATCH_HOLD_REASON = 'sanctions_match';
/** Hold reason used when an admin places a hold without giving one. */
const DEFAULT_MANUAL_HOLD_REASON = 'manual_hold';

/** Audit actions written to `transactions_logs` for hold changes. */
export const PAYOUT_HOLD_PLACED_ACTION = 'PAYOUT_HOLD_PLACED';
export const PAYOUT_HOLD_CLEARED_ACTION = 'PAYOUT_HOLD_CLEARED';

export interface PayoutHoldState {
  active: boolean;
  reason: string | null;
  placedAt: Date | null;
}

// A type alias (not an interface) so it is assignable to AppError's ErrorDetails index signature.
type BlockedRecipient = {
  recipientPublicKey: string;
  reason: string;
};

/**
 * Gates royalty payouts on compliance holds and sanctions screening (#985).
 *
 * A recipient is blocked when its account carries a payout hold, or when the
 * screening provider reports a match. A match also places a hold on the account,
 * so later payouts stay blocked until an admin reviews it. A provider failure
 * blocks the payout too. Nothing is paid or recorded on an unresolved screen.
 */
export class SanctionsScreeningService {
  private userRepo: Repository<User>;
  private transactionLog: TransactionLogService;
  private provider?: SanctionsScreeningProvider;

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
    this.transactionLog = new TransactionLogService();
  }

  /**
   * Throws PAYOUT_BLOCKED when any recipient is held or matches the sanctions
   * screen. Throws SCREENING_UNAVAILABLE when the provider cannot answer.
   *
   * @param recipientPublicKeys - Stellar public keys that are to receive a payout.
   */
  async assertRecipientsCleared(recipientPublicKeys: string[]): Promise<void> {
    const keys = [...new Set(recipientPublicKeys)];
    if (keys.length === 0) return;

    const users = await this.userRepo.findBy({ stellarPublicKey: In(keys) });
    const userByKey = new Map(users.map((user) => [user.stellarPublicKey, user]));
    const blocked: BlockedRecipient[] = [];

    for (const key of keys) {
      const user = userByKey.get(key);

      if (user?.payoutHoldReason) {
        blocked.push({ recipientPublicKey: key, reason: 'payout_hold' });
        continue;
      }

      const outcome = await this.screen(key);
      if (outcome.status === 'match') {
        await this.placeSanctionsHold(user, outcome.reference);
        blocked.push({ recipientPublicKey: key, reason: SANCTIONS_MATCH_HOLD_REASON });
      }
    }

    if (blocked.length > 0) {
      throw AppError.authorization(
        'Payout blocked by compliance hold',
        blocked,
        PAYOUT_BLOCKED_CODE,
      );
    }
  }

  /**
   * Places or clears a payout hold on an account. Admin action. The change is
   * written to the audit log with the acting admin as the actor.
   *
   * @param userId - The account to hold or release.
   * @param hold - true to hold payouts, false to clear the hold.
   * @param reason - Optional free-text reason, stored on the hold.
   * @param actorId - The admin performing the change.
   */
  async setPayoutHold(
    userId: string,
    hold: boolean,
    reason: string | undefined,
    actorId: string,
  ): Promise<PayoutHoldState> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) {
      throw AppError.notFound('User not found');
    }

    const trimmedReason = reason?.trim() || undefined;
    const reasonValue: string | null = hold ? trimmedReason || DEFAULT_MANUAL_HOLD_REASON : null;
    const placedAt: Date | null = hold ? new Date() : null;

    await this.userRepo.update(
      { id: userId },
      { payoutHoldReason: reasonValue, payoutHoldPlacedAt: placedAt },
    );

    await this.transactionLog.createLogEntry(
      actorId,
      '',
      hold ? PAYOUT_HOLD_PLACED_ACTION : PAYOUT_HOLD_CLEARED_ACTION,
      `target=${userId} reason=${trimmedReason ?? 'none'}`,
    );

    return { active: hold, reason: reasonValue, placedAt };
  }

  private getProvider(): SanctionsScreeningProvider {
    if (!this.provider) {
      this.provider = createScreeningProviderFromEnv();
    }
    return this.provider;
  }

  private async screen(recipientPublicKey: string): Promise<ScreeningOutcome> {
    try {
      return await this.getProvider().screen({ stellarPublicKey: recipientPublicKey });
    } catch (error) {
      logger.error({ err: error }, 'Sanctions screening unavailable; payout blocked');
      throw AppError.externalService(
        'Sanctions screening is unavailable',
        undefined,
        SCREENING_UNAVAILABLE_CODE,
      );
    }
  }

  private async placeSanctionsHold(user: User | undefined, reference: string): Promise<void> {
    logger.warn({ userId: user?.id, reference }, 'Sanctions screening matched a payout recipient');

    // A recipient with no local account (an external wallet) has nothing to hold.
    // The payout is still blocked for this request.
    if (!user) return;

    await this.userRepo.update(
      { id: user.id },
      {
        payoutHoldReason: SANCTIONS_MATCH_HOLD_REASON,
        payoutHoldPlacedAt: new Date(),
      },
    );

    await this.transactionLog.createLogEntry(
      user.id,
      '',
      PAYOUT_HOLD_PLACED_ACTION,
      `automatic: ${SANCTIONS_MATCH_HOLD_REASON} (${reference})`,
    );
  }
}
