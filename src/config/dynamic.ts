import { authenticatedEvmClient } from '../utils/dynamicUtils';
import { Sepolia } from 'viem/chains';
import logger from './logger';

export async function getLiskPublicClient() {
  const evmClient = await authenticatedEvmClient();
  const publicClient = evmClient.createViemPublicClient({
    chain: Sepolia,
    rpcUrl: process.env.LISK_SEPOLIA_RPC_URL!,
  });
  logger.info('Lisk Public client initialized');
  return publicClient;
}
