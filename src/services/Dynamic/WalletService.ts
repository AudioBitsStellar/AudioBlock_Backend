import { ThresholdSignatureScheme } from "@dynamic-labs-wallet/core";

import {
  authenticatedEvmClient,
  createEvmWallet,
} from "../../utils/dynamicUtils";
import { SignMessageDTO } from "../../dtos/SignMessageDTO";
import redis from "../../config/redis";
import logger from "../../utils/logger";

export class WalletService {
  constructor() {}

  async createWallet(): Promise<any> {
    try {
      const wallet = await createEvmWallet({
        thresholdSignatureScheme: ThresholdSignatureScheme.TWO_OF_TWO,
      });
      // log the address only; the full wallet object carries key material
      logger.info({ accountAddress: wallet.accountAddress }, "Wallet created");

      return wallet;
    } catch (error: any) {
      if (error.message.includes("insufficient funds")) {
        logger.error("Insufficient funds for wallet creation");
        throw new Error("Dynamic: Insufficient funds for wallet creation");
      } else if (error.message.includes("invalid session")) {
        logger.error("Invalid session ID - please re-authenticate");
        throw new Error("Dynamic: Invalid session ID - please re-authenticate");
      } else {
        logger.error({ err: error }, "Wallet creation failed");
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
      logger.error({ err: error }, "Error signing message");
      throw new Error("Dynamic: Error signing message");
    }
  }
  
}
