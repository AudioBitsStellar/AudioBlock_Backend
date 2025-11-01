import { validate } from "class-validator";
import { User } from "../../entities/User";
import AppDataSource from "../../config/db";
import { Repository } from "typeorm";
import dotenv from "dotenv";
import { getLiskPublicClient } from "../../config/dynamic";
import { LiskSepoliaFacetAddress } from "../../utils/facets";
import { encodeFunctionData } from "viem";
import { parseAbi } from "viem";
import { ArtistFacetABI } from "../../abis/ArtistFacet";
import { liskSepolia } from "viem/chains";
import {
  accountWalletClient,
  authenticatedEvmClient,
  keyShare,
} from "../../utils/dynamicUtils";
import { ArtistFacetV2ABI } from "../../abis/ArtistFacetV2";

export class ArtistService {
  async setupArtistAccountOnChain(walletAddress: string): Promise<`0x${string}`> {
  try {
    const publicClient = await getLiskPublicClient();
    const evmClient = await authenticatedEvmClient();

    const data = encodeFunctionData({
      abi: ArtistFacetV2ABI,
      functionName: "setupArtistProfile",
      args: [],
    });

    const transactionRequest = {
      to: LiskSepoliaFacetAddress.Diamond as `0x${string}`,
      data,
      account: walletAddress as `0x${string}`,
    };

    const preparedTx = await publicClient.prepareTransactionRequest({
      ...transactionRequest,
      chain: liskSepolia
    });

    console.log("Prepared transaction:", preparedTx);

    const signedTx = await evmClient.signTransaction({
      senderAddress: walletAddress as `0x${string}`,
      externalServerKeyShares: await keyShare(walletAddress),
      transaction: {
        to: preparedTx.to,
        data: preparedTx.data,
        chainId: preparedTx.chainId,
        gas: preparedTx.gas,
        maxFeePerGas: preparedTx.maxFeePerGas,
        maxPriorityFeePerGas: preparedTx.maxPriorityFeePerGas,
        nonce: preparedTx.nonce,
        type: 'eip1559', // Explicitly set transaction type
      },
    });

    console.log("Signed transaction:", signedTx);

     const txHash = await publicClient.sendRawTransaction({
      serializedTransaction: signedTx as `0x${string}`,
    });
    console.log(`Transaction sent with hash: ${txHash}`);

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);

    console.log(`Transaction sent with hash: ${txHash}`);
    return txHash;
  } catch (error) {
    console.error("Error setting up artist account on-chain:", error);
    throw new Error("ArtistService: Error setting up artist account on-chain");
  }
  }
}
