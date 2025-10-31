import { authenticatedEvmClient } from "../utils/dynamicUtils";
import { liskSepolia, lisk } from "viem/chains";

export async function getLiskPublicClient() {
  const evmClient = await authenticatedEvmClient();
  const publicClient = evmClient.createViemPublicClient({
    chain: liskSepolia,
    rpcUrl: process.env.LISK_SEPOLIA_RPC_URL!,
  });
  console.log("Lisk Public client initialized:", publicClient);
  return publicClient;
}