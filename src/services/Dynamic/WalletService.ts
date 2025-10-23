
import { ThresholdSignatureScheme } from '@dynamic-labs-wallet/core';

import { baseSepolia } from 'viem/chains';
import { parseEther } from 'viem/utils';
import { createEvmWallet } from '../../utils/dynamicUtils';

export class WalletService { 

    constructor() {}


    async createEvmWallet(): Promise<any> {
        try {
            const wallet = await createEvmWallet({
                thresholdSignatureScheme: ThresholdSignatureScheme.TWO_OF_TWO,
            });
            console.log('Wallet created successfully:', wallet);
            console.log('Wallet created successfully:', wallet.accountAddress);

            return wallet
        } catch (error: any) {
            if (error.message.includes('insufficient funds')) {
                console.error('Insufficient funds for wallet creation');
                throw new Error('Dynamic: Insufficient funds for wallet creation');
            } else if (error.message.includes('invalid session')) {
                console.error('Invalid session ID - please re-authenticate');
                throw new Error('Dynamic: Invalid session ID - please re-authenticate');
            } else {
                console.error('Wallet creation failed:', error.message);
                throw new Error('Dynamic: Wallet creation failed');
            }
        }
    }
    
}