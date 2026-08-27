import { WalletService } from './../services/Dynamic/WalletService';
import { TransactionLogService } from '../services/TransactionLogService';

import { handleError } from '../utils/helpers';
import { Request, Response } from 'express';

export class WalletController {
  private walletService: WalletService;
  private transactionLogService: TransactionLogService;

  constructor() {
    this.walletService = new WalletService();
    this.transactionLogService = new TransactionLogService();
  }

  createEvmWallet = async (req: Request, res: Response) => {
    try {
      const wallet = await this.walletService.createWallet();
      res.status(201).json({ success: true, message: 'Wallet created successfully', wallet });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  signMessage = async (req: Request, res: Response) => {
    try {
      const payload = req.body;
      const signature = await this.walletService.signMessage(payload);
      res.status(200).json({ success: true, message: 'Message signed successfully', signature });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /** GET /api/wallet/history — balance history with filtering and pagination (Issue #84). */
  getWalletHistory = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { type, from, to } = req.query;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      const result = await this.transactionLogService.getWalletHistory(
        userId,
        {
          type: type as string | undefined,
          from: from as string | undefined,
          to: to as string | undefined,
        },
        page,
        limit,
      );

      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
