import { WalletService } from './../services/Dynamic/WalletService';

import { handleError } from '../utils/helpers';
import { Request, Response } from 'express';

export class WalletController {

    private walletService: WalletService;

    constructor() {
        this.walletService = new WalletService();
    }

    createEvmWallet = async(req: Request, res: Response) => {
        try {
            const wallet = await this.walletService.createWallet();
            res.status(201).json({success: true, message: "Wallet created successfully", wallet});
        
        } catch (error) {
            handleError(res, error);
        }
    }

    signMessage = async(req: Request, res: Response) => {
        try {
            const payload = req.body;
            const signature = await this.walletService.signMessage(payload);
            res.status(200).json({success: true, message: "Message signed successfully", signature});
        
        } catch (error) {
            handleError(res, error);
        }
    }
    
}