import {
  rpc,
  TransactionBuilder,
  Contract,
  nativeToScVal,
  scValToNative,
  BASE_FEE,
  xdr,
} from "@stellar/stellar-sdk";
import { getNetworkPassphrase, getSorobanServer } from "../../config/soroban";

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30000;

export interface SorobanSubmitResult {
  hash: string;
  returnValue: unknown;
}

/**
 * Generic helper for the "client signs, backend relays" Soroban flow:
 * the backend never holds an artist's secret key. It builds + simulates an
 * unsigned invocation for the artist's own Stellar account (the wallet,
 * e.g. Freighter, is both the fee-paying source account and the address
 * being authorized), returns it as XDR for the wallet to sign, then submits
 * the signed XDR the client sends back.
 */
export class SorobanService {
  private server = getSorobanServer();

  /**
   * Builds, simulates, and assembles an unsigned invocation ready to sign.
   *
   * Transaction Time Bounds:
   * - Sets timeout to 120 seconds (2 minutes) from preparation
   * - Frontend wallets (e.g., Freighter) must sign within this window
   * - Expired transactions return TRANSACTION_EXPIRED error code from submit endpoints
   * - Frontend should display countdown timer and handle expiration gracefully
   *
   * See docs/ON_CHAIN_INTEGRATION.md for frontend coordination guidelines.
   */
  async prepareInvocation(
    sourcePublicKey: string,
    contractId: string,
    method: string,
    args: xdr.ScVal[],
  ): Promise<string> {
    const account = await this.server.getAccount(sourcePublicKey);
    const contract = new Contract(contractId);
    const operation = contract.call(method, ...args);

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(operation)
      .setTimeout(120) // 120 seconds - coordinate with frontend signing UX
      .build();

    const prepared = await this.server.prepareTransaction(transaction);
    return prepared.toXDR();
  }

  /** Submits a wallet-signed XDR and waits for it to land. */
  async submitSignedTransaction(
    signedXdr: string,
  ): Promise<SorobanSubmitResult> {
    const transaction = TransactionBuilder.fromXDR(
      signedXdr,
      getNetworkPassphrase(),
    );
    const sendResponse = await this.server.sendTransaction(transaction);

    if (sendResponse.status === "ERROR") {
      throw new Error(
        `Soroban transaction rejected: ${JSON.stringify(sendResponse.errorResult)}`,
      );
    }

    const hash = sendResponse.hash;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let getResponse = await this.server.getTransaction(hash);

    while (getResponse.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for Soroban transaction ${hash}`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      getResponse = await this.server.getTransaction(hash);
    }

    if (getResponse.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(
        `Soroban transaction ${hash} failed with status ${getResponse.status}`,
      );
    }

    const returnValue = getResponse.returnValue
      ? scValToNative(getResponse.returnValue)
      : undefined;
    return { hash, returnValue };
  }
}

export function addressArg(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "address" });
}

export function stringArg(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "string" });
}

export function u64Arg(value: number | string): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: "u64" });
}
