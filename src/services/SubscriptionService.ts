import { Repository } from 'typeorm';
import { Subscription, SubscriptionTier, SubscriptionStatus } from '../entities/Subscription';
import AppDataSource from '../config/db';
import { AppError } from '../errors/AppError';
import { validateRequired } from '../validators/ServiceValidator';

/**
 * Service layer for subscription management.
 * Handles subscription creation, updates, cancellation, and tier checks.
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

    // Check if subscription has expired
    if (subscription && subscription.endDate && new Date() > subscription.endDate) {
      subscription.status = SubscriptionStatus.EXPIRED;
      await this.subscriptionRepo.save(subscription);
      return null;
    }

    return subscription;
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
