import { ThresholdSignatureScheme } from "@dynamic-labs-wallet/core";

import {
  authenticatedEvmClient,
  createEvmWallet,
} from "../../utils/dynamicUtils";
import { SignMessageDTO } from "../../dtos/SignMessageDTO";
import redis from "../../config/redis";

export class WalletService {
  constructor() {}

  async createWallet(): Promise<any> {
    try {
      const wallet = await createEvmWallet({
        thresholdSignatureScheme: ThresholdSignatureScheme.TWO_OF_TWO,
      });
      console.log("Wallet created successfully:", wallet);
      console.log("Wallet created successfully:", wallet.accountAddress);

      return wallet;
    } catch (error: any) {
      if (error.message.includes("insufficient funds")) {
        console.error("Insufficient funds for wallet creation");
        throw new Error("Dynamic: Insufficient funds for wallet creation");
      } else if (error.message.includes("invalid session")) {
        console.error("Invalid session ID - please re-authenticate");
        throw new Error("Dynamic: Invalid session ID - please re-authenticate");
      } else {
        console.error("Wallet creation failed:", error.message);
        throw new Error("Dynamic: Wallet creation failed");
      }
    }
  }

  async signMessage(data: SignMessageDTO): Promise<any> {
    try {
      // Extract nonce from message
      const nonceMatch = data.message.match(/Nonce: (\w+)/);
      if (!nonceMatch) throw new Error("Nonce missing in message");
      const nonce = nonceMatch[1];

      // Verify nonce exists and matches stored one
      const storedNonce = await redis.get(`nonce:${data.email}`);
      if (!storedNonce || storedNonce !== nonce) {
        throw new Error("Invalid or expired nonce");
      }

      const evmClient = await authenticatedEvmClient();

      const externalServerKeyShares =
        await evmClient.exportExternalServerKeyShares({
          accountAddress: data.walletAddress,
        });
      const signature = await evmClient.signMessage({
        message: data.message,
        accountAddress: data.walletAddress,
        externalServerKeyShares,
      });
      return signature;
    } catch (error: any) {
      console.error("Error signing message:", error.message);
      throw new Error("Dynamic: Error signing message");
    }
  }
  
}
