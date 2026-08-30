import { Repository } from 'typeorm';
import { Subscription, SubscriptionTier, SubscriptionStatus } from '../entities/Subscription';
import AppDataSource from '../config/db';
import { AppError } from '../errors/AppError';
import { validateRequired } from '../validators/ServiceValidator';

/** Default length of a billed subscription period after a trial ends (30 days). */
const DEFAULT_BILLING_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Service layer for subscription management.
 * Handles subscription creation, updates, cancellation, trials, and tier checks.
 */
export class SubscriptionService {
  private subscriptionRepo: Repository<Subscription>;

  constructor() {
    this.subscriptionRepo = AppDataSource.getRepository(Subscription);
  }

  /**
   * Get user's current active subscription.
   *
   * @param userId - The user's UUID
   * @returns Active subscription or null if user has no active subscription
   */
  async getUserSubscription(userId: string): Promise<Subscription | null> {
    validateRequired(userId, 'userId');

    const subscription = await this.subscriptionRepo.findOne({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    if (!subscription) {
      return null;
    }

    // Check if subscription has expired
    if (subscription.endDate && new Date() > subscription.endDate) {
      subscription.status = SubscriptionStatus.EXPIRED;
      await this.subscriptionRepo.save(subscription);
      return null;
    }

    // A subscription inside its trial grants gated features without billing.
    // If the trial has elapsed, finalise it: the subscription stops being a
    // trial and becomes a paid (billed) subscription for a standard period.
    if (subscription.trialEndsAt) {
      if (new Date() < subscription.trialEndsAt) {
        return subscription;
      }
      await this.finalizeTrialTransition(subscription);
    }

    return subscription;
  }

  /**
   * Transition a subscription out of its trial. Clears the trial marker and
   * converts the subscription into a billed/paid subscription for the current
   * period, so gating continues to apply while the user is billed normally.
   *
   * @param subscription - The subscription whose trial has elapsed.
   */
  private async finalizeTrialTransition(subscription: Subscription): Promise<void> {
    if (!subscription.trialEndsAt) {
      return;
    }

    const trialEndedAt = subscription.trialEndsAt;

    // Trial is over: this is the point at which billing would begin. Clear the
    // trial marker so the user is no longer treated as an un-billed trialist.
    // The subscription remains active (billed) for a standard period starting
    // at the trial end. If an explicit endDate was set it is preserved.
    subscription.trialEndsAt = undefined;

    if (!subscription.endDate) {
      subscription.endDate = new Date(trialEndedAt.getTime() + DEFAULT_BILLING_PERIOD_MS);
    }

    await this.subscriptionRepo.save(subscription);
  }

  /**
   * Create or upgrade a user's subscription.
   *
   * @param userId - The user's UUID
   * @param tier - The subscription tier to create/upgrade to
   * @param endDate - Optional end date for the subscription
   * @returns The created or updated subscription
   */
  async createOrUpgradeSubscription(
    userId: string,
    tier: SubscriptionTier,
    endDate?: Date,
  ): Promise<Subscription> {
    validateRequired(userId, 'userId');
    validateRequired(tier, 'tier');

    // Validate tier
    if (!Object.values(SubscriptionTier).includes(tier)) {
      throw AppError.validation(`Invalid tier: ${tier}`, [
        {
          field: 'tier',
          message: `Tier must be one of: ${Object.values(SubscriptionTier).join(', ')}`,
        },
      ]);
    }

    // Check for existing active subscription
    const existingSubscription = await this.getUserSubscription(userId);

    if (existingSubscription) {
      // Upgrade/downgrade existing subscription
      existingSubscription.tier = tier;
      if (endDate) {
        existingSubscription.endDate = endDate;
      }
      return await this.subscriptionRepo.save(existingSubscription);
    }

    // Create new subscription
    const subscription = this.subscriptionRepo.create({
      userId,
      tier,
      status: SubscriptionStatus.ACTIVE,
      startDate: new Date(),
      endDate,
    });

    return await this.subscriptionRepo.save(subscription);
  }

  /**
   * Start a free trial for a user on a given tier.
   *
   * The subscription is created as ACTIVE with `trialEndsAt` set to now plus
   * `trialDays`. While inside the trial the subscriber gains gated features
   * WITHOUT being billed (no `endDate` is set, mirroring "no charge yet").
   * When the trial elapses, `getUserSubscription` finalises it into a paid
   * (billed) subscription.
   *
   * If the user already has an active subscription, the trial cannot be
   * started (they are already a paying customer).
   *
   * @param userId - The user's UUID
   * @param tier - The tier to trial (e.g. ARTIST_PRO)
   * @param trialDays - Length of the trial period in days (must be > 0)
   * @returns The created trial subscription
   * @throws {AppError} If the user already has an active subscription or the
   *   trial duration is invalid
   */
  async startTrial(
    userId: string,
    tier: SubscriptionTier,
    trialDays: number,
  ): Promise<Subscription> {
    validateRequired(userId, 'userId');

    if (!Object.values(SubscriptionTier).includes(tier)) {
      throw AppError.validation(`Invalid tier: ${tier}`, [
        { field: 'tier', message: 'Tier must be a valid subscription tier' },
      ]);
    }

    if (!Number.isFinite(trialDays) || trialDays <= 0) {
      throw AppError.validation('trialDays must be a positive number', [
        { field: 'trialDays', message: 'Trial duration must be greater than zero days' },
      ]);
    }

    const existing = await this.getUserSubscription(userId);
    if (existing) {
      throw AppError.validation('Cannot start a trial: user already has an active subscription', [
        { field: 'trial', message: 'An active subscription already exists' },
      ]);
    }

    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
    const subscription = this.subscriptionRepo.create({
      userId,
      tier,
      status: SubscriptionStatus.ACTIVE,
      startDate: new Date(),
      // No endDate -> the user is not billed during the trial.
      trialEndsAt,
    });

    return await this.subscriptionRepo.save(subscription);
  }

  /**
   * Check whether a user's subscription is currently inside its free trial.
   *
   * @param userId - The user's UUID
   * @returns true when the user has a subscription whose trial is still active
   */
  async isInTrial(userId: string): Promise<boolean> {
    const subscription = await this.getUserSubscription(userId);
    return Boolean(
      subscription && subscription.trialEndsAt && new Date() < subscription.trialEndsAt,
    );
  }

  /**
   * Cancel a user's subscription at the period end.
   * The subscription remains active until endDate.
   *
   * @param userId - The user's UUID
   * @returns The cancelled subscription
   * @throws {AppError} If no active subscription found
   */
  async cancelSubscription(userId: string): Promise<Subscription> {
    validateRequired(userId, 'userId');

    const subscription = await this.getUserSubscription(userId);

    if (!subscription) {
      throw AppError.notFound('No active subscription found');
    }

    subscription.status = SubscriptionStatus.CANCELLED;

    return await this.subscriptionRepo.save(subscription);
  }

  /**
   * Check if a user has access to a specific tier level.
   * Used for feature gating based on subscription tier.
   *
   * @param userId - The user's UUID
   * @param requiredTier - The minimum tier required
   * @returns true if user has the required tier or higher
   */
  async hasTierAccess(userId: string, requiredTier: SubscriptionTier): Promise<boolean> {
    const subscription = await this.getUserSubscription(userId);

    if (!subscription) {
      // No subscription means FREE tier
      return requiredTier === SubscriptionTier.FREE;
    }

    // Tier hierarchy: FREE < ARTIST_PRO < LABEL
    const tierHierarchy = {
      [SubscriptionTier.FREE]: 0,
      [SubscriptionTier.ARTIST_PRO]: 1,
      [SubscriptionTier.LABEL]: 2,
    };

    return tierHierarchy[subscription.tier] >= tierHierarchy[requiredTier];
  }
}
