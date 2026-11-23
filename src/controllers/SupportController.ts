import { Request, Response } from 'express';
import { handleError } from '../utils/helpers';
import { HTTP_STATUS } from '../config/constants';
import { AppError } from '../errors/AppError';
import { routeParam } from '../utils/routeParams';
import { SupportUserService } from '../services/Support/SupportUserService';
import { SanctionsScreeningService } from '../services/Compliance/SanctionsScreeningService';
import { SetPayoutHoldDTO } from '../dtos/SetPayoutHoldDTO';

/**
 * Support user lookup (#983) and payout compliance holds (#985).
 * Routes gate both handlers with the USER_MANAGE permission.
 */
export class SupportController {
  private static supportUsers = new SupportUserService();
  private static sanctionsScreening = new SanctionsScreeningService();

  /**
   * GET /api/admin/users/lookup?query=... — read-only, audited lookup by an exact
   * identifier (email, username, wallet, Stellar key, Privy id, or UUID).
   */
  static lookupUser = async (req: Request, res: Response) => {
    try {
      const actorId = (req as any).user?.id;
      if (!actorId) {
        return handleError(req, res, AppError.authentication('Admin not authenticated'));
      }

      const query = typeof req.query.query === 'string' ? req.query.query : '';
      const user = await SupportController.supportUsers.lookupUser(query, actorId);
      if (!user) {
        return handleError(req, res, AppError.notFound('User not found'));
      }

      return res.status(HTTP_STATUS.OK).json({ success: true, data: user });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * PUT /api/admin/users/:id/payout-hold — places or clears a payout hold on an
   * account. Excludes the account from royalty payouts until it is cleared (#985).
   */
  static setPayoutHold = async (req: Request, res: Response) => {
    try {
      const actorId = (req as any).user?.id;
      if (!actorId) {
        return handleError(req, res, AppError.authentication('Admin not authenticated'));
      }

      const userId = routeParam(req.params.id);
      const { hold, reason } = req.body as SetPayoutHoldDTO;
      const payoutHold = await SupportController.sanctionsScreening.setPayoutHold(
        userId,
        hold,
        reason,
        actorId,
      );

      return res.status(HTTP_STATUS.OK).json({
        success: true,
        data: { userId, payoutHold },
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
