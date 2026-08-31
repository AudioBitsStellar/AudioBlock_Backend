import {
  rpc,
  TransactionBuilder,
  Contract,
  nativeToScVal,
  scValToNative,
  BASE_FEE,
  xdr,
} from '@stellar/stellar-sdk';
import { getNetworkPassphrase, getSorobanServer } from '../../config/soroban';
import { RoyaltyPayoutEvent } from '../../types';
import logger from '../../config/logger';

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30000;

// ── Rate-limiting / backoff configuration (Issue #244) ──
const MAX_CONCURRENT_RPC = parseInt(process.env.SOROBAN_MAX_CONCURRENT_RPC || '5', 10);
const BACKOFF_BASE_MS = parseInt(process.env.SOROBAN_BACKOFF_BASE_MS || '1000', 10);
const BACKOFF_MAX_MS = parseInt(process.env.SOROBAN_BACKOFF_MAX_MS || '30000', 10);
const BACKOFF_MAX_RETRIES = parseInt(process.env.SOROBAN_BACKOFF_MAX_RETRIES || '5', 10);

export interface SorobanSubmitResult {
  hash: string;
  returnValue: unknown;
}

/**
 * Simple semaphore for limiting concurrent RPC calls.
 */
class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof rpc.Api.PreparedTransactionError) return false;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Rate-limited or server errors from Soroban RPC
    if (msg.includes('429') || msg.includes('rate limit')) return true;
    if (msg.includes('5') && (msg.includes('internal') || msg.includes('server'))) return true;
    if (msg.includes('econnrefused') || msg.includes('etimedout')) return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  private semaphore = new Semaphore(MAX_CONCURRENT_RPC);

  /**
   * Executes an RPC call with exponential backoff on transient errors.
   */
  private async withBackoff<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= BACKOFF_MAX_RETRIES; attempt++) {
      await this.semaphore.acquire();
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < BACKOFF_MAX_RETRIES && isRetryableError(err)) {
          const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_MAX_MS);
          logger.warn({ attempt, delay, label }, 'Soroban RPC call failed, retrying with backoff');
          await sleep(delay);
        } else {
          throw err;
        }
      } finally {
        this.semaphore.release();
      }
    }
    throw lastError;
  }

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
    const account = await this.withBackoff(
      () => this.server.getAccount(sourcePublicKey),
      `getAccount(${sourcePublicKey})`,
    );
    const contract = new Contract(contractId);
    const operation = contract.call(method, ...args);

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(operation)
      .setTimeout(120) // 120 seconds - coordinate with frontend signing UX
      .build();

    const prepared = await this.withBackoff(
      () => this.server.prepareTransaction(transaction),
      `prepareTransaction`,
    );
    return prepared.toXDR();
  }

  /** Submits a wallet-signed XDR and waits for it to land. */
  async submitSignedTransaction(signedXdr: string): Promise<SorobanSubmitResult> {
    const transaction = TransactionBuilder.fromXDR(signedXdr, getNetworkPassphrase());
    const sendResponse = await this.withBackoff(
      () => this.server.sendTransaction(transaction),
      'sendTransaction',
    );

    if (sendResponse.status === 'ERROR') {
      throw new Error(`Soroban transaction rejected: ${JSON.stringify(sendResponse.errorResult)}`);
    }

    const hash = sendResponse.hash;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let getResponse = await this.withBackoff(
      () => this.server.getTransaction(hash),
      `getTransaction(${hash})`,
    );

    while (getResponse.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for Soroban transaction ${hash}`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      getResponse = await this.withBackoff(
        () => this.server.getTransaction(hash),
        `getTransaction(${hash}) polling`,
      );
    }

    if (getResponse.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`Soroban transaction ${hash} failed with status ${getResponse.status}`);
    }

    const returnValue = getResponse.returnValue
      ? scValToNative(getResponse.returnValue)
      : undefined;
    return { hash, returnValue };
  }

  async getRoyaltyPayoutEvents(
    royaltyContractId: string,
    saleEventIds: string[],
  ): Promise<RoyaltyPayoutEvent[]> {
    if (saleEventIds.length === 0) {
      return [];
    }

    const serverWithEvents = this.server as unknown as {
      getEvents?: (request: {
        filters: Array<{ type: 'contract'; contractIds: string[] }>;
        limit: number;
      }) => Promise<{ events: Array<{ id?: string; value?: unknown; topic?: unknown[] }> }>;
    };

    if (!serverWithEvents.getEvents) {
      throw new Error('Configured Soroban RPC client does not support event reads');
    }

    const response = await this.withBackoff(
      () =>
        serverWithEvents.getEvents!({
          filters: [{ type: 'contract', contractIds: [royaltyContractId] }],
          limit: 200,
        }),
      'getEvents',
    );

    return response.events
      .map((event) => this.parseRoyaltyPayoutEvent(event))
      .filter((event): event is RoyaltyPayoutEvent => {
        return Boolean(event && saleEventIds.includes(event.saleEventId));
      });
  }

  private parseRoyaltyPayoutEvent(event: {
    id?: string;
    value?: unknown;
    topic?: unknown[];
  }): RoyaltyPayoutEvent | undefined {
    const value = event.value as Partial<RoyaltyPayoutEvent> | undefined;

    if (!value || !value.saleEventId || !value.recipientPublicKey || !value.amountStroops) {
      return undefined;
    }

    return {
      saleEventId: String(value.saleEventId),
      onChainEventId: String(value.onChainEventId || event.id || ''),
      recipientPublicKey: String(value.recipientPublicKey),
      amountStroops: String(value.amountStroops),
    };
  }
}

export function addressArg(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: 'address' });
}

export function stringArg(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: 'string' });
}

export function u64Arg(value: number | string): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: 'u64' });
}
