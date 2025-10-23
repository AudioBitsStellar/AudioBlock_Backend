import { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import { ThresholdSignatureScheme } from '@dynamic-labs-wallet/core';

import { baseSepolia } from 'viem/chains';
import { parseEther } from 'viem/utils';
export const authenticatedEvmClient = async () => {
  const client = new DynamicEvmWalletClient({
    environmentId: process.env.DYNAMIC_ENVIRONMENT_ID!,
  });

  await client.authenticateApiToken(process.env.DYNAMIC_AUTH_TOKEN!);
  return client;
};

export const createEvmWallet = async ({
  thresholdSignatureScheme = ThresholdSignatureScheme.TWO_OF_TWO,
  password
}: {
  thresholdSignatureScheme?: ThresholdSignatureScheme;
  password?: string;
}) => {
  const evmClient = await authenticatedEvmClient();

  const wallet = await evmClient.createWalletAccount({
    thresholdSignatureScheme,
    password,
    backUpToClientShareService: true,
  });

  return wallet;
  return {
    accountAddress: wallet.accountAddress,
    publicKeyHex: wallet.publicKeyHex,
    walletId: wallet.walletId,
  };
};