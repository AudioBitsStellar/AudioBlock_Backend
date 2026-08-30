import { Request, Response } from 'express';
import { AppDataSource } from '../config/data-source';
import { SubscriptionTierConfig } from '../entities/SubscriptionTierConfig';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';

/**
 * Controller for subscription tier configuration (Issue #413).
 *
 * Admin-only endpoints to manage tier pricing and feature sets.
 * A public endpoint reads the config so the pricing page can render
 * without hardcoding tier metadata.
 */
export class SubscriptionTierConfigController {
  /**
   * List all configured tiers (public).
   * GET /api/subscriptions/tiers
   */
  listTiers = async (req: Request, res: Response): Promise<void> => {
    try {
      const repo = AppDataSource.getRepository(SubscriptionTierConfig);
      const tiers = await repo.find({ order: { sortOrder: 'ASC' } });
      res.json({ tiers });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Create or update a tier configuration (admin only).
   * PUT /api/subscriptions/tiers/:tier
   */
  upsertTier = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tier } = req.params;
      const repo = AppDataSource.getRepository(SubscriptionTierConfig);
      let config = await repo.findOneBy({ tier: tier as any });

      if (config) {
        Object.assign(config, req.body);
      } else {
        config = repo.create({ tier, ...req.body });
      }

      await repo.save(config);
      res.json({ tier: config });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Delete a tier configuration (admin only).
   * DELETE /api/subscriptions/tiers/:tier
   */
  deleteTier = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tier } = req.params;
      const repo = AppDataSource.getRepository(SubscriptionTierConfig);
      const config = await repo.findOneBy({ tier: tier as any });
      if (!config) {
        return handleError(req, res, AppError.notFound('Tier not found'));
      }
      await repo.remove(config);
      res.json({ deleted: true });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
