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
            const wallet = await this.walletService.createEvmWallet();
            res.status(201).json({success: true, message: "Wallet created successfully", wallet});
        
        } catch (error) {
            handleError(res, error);
        }
    }

    
    
}