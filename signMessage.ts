// signMessage.ts
import { ethers, Wallet } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

const run = async (): Promise<void> => {
    try {
        const privateKey = process.env.PRIVATE_KEY;

        if (!privateKey) {
            throw new Error('PRIVATE_KEY is not defined in the environment variables');
        }

        // 1. Connect to wallet
        const wallet: Wallet = new ethers.Wallet(privateKey);
        console.log('Wallet connected:', wallet.address);

        // 2. Generate message
        const message: string = `Sign this message to authenticate: ${new Date().toISOString()}`;
        console.log('Message to sign:', message);

        // 3. Sign the message
        const signature: string = await wallet.signMessage(message);
        console.log('Signature:', signature);

        // 4. Output result
        console.log('Wallet Address:', wallet.address);
        console.log('Signed Message:', message);
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error('Error signing message:', error.message);
        } else {
            console.error('Unknown error:', error);
        }
    }
};

run();
