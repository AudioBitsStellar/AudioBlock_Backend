import { authenticatedEvmClient } from '../utils/dynamicUtils';
import { Sepolia } from 'viem/chains';

export async function getLiskPublicClient() {
  const evmClient = await authenticatedEvmClient();
  const publicClient = evmClient.createViemPublicClient({
    chain: Sepolia,
    rpcUrl: process.env.LISK_SEPOLIA_RPC_URL!,
  });
  console.log('Lisk Public client initialized:', publicClient);
  return publicClient;
}
