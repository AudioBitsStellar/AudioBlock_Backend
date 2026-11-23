import {
  FeeBumpTransaction,
  StrKey,
  TransactionBuilder,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import logger from '../../config/logger';

/** Marketplace contract functions this reader understands. */
export type MarketplaceFunction = 'list_nft' | 'buy_nft' | 'create_auction' | 'place_bid';

const MARKETPLACE_FUNCTIONS: readonly MarketplaceFunction[] = [
  'list_nft',
  'buy_nft',
  'create_auction',
  'place_bid',
];

/**
 * What a signed marketplace transaction actually asks the contract to do.
 *
 * Read from the XDR the wallet signed, so every field describes the operation
 * that will land on-chain rather than what the caller put in the request body.
 */
export interface MarketplaceIntent {
  functionName: MarketplaceFunction;
  contractId: string;
  /** Soroban `u64` token id, as a decimal string. */
  tokenId: string;
  /** First address argument: the seller, or the buyer/bidder for those calls. */
  signerAddress: string;
  /** Ask price (`list_nft`), reserve (`create_auction`) or bid (`place_bid`). */
  amountStroops?: string;
  /** Auction length in seconds; only `create_auction` carries it. */
  durationSeconds?: number;
}

export interface MarketplaceIntentOptions {
  networkPassphrase: string;
  /** Rejects invocations aimed at any contract other than the active marketplace. */
  marketplaceContractId: string;
}

/** `feeBump` transactions wrap the real operation one level down. */
function operationsOf(transaction: unknown): unknown[] {
  if (transaction instanceof FeeBumpTransaction) {
    return transaction.innerTransaction.operations;
  }
  const operations = (transaction as { operations?: unknown[] })?.operations;
  return Array.isArray(operations) ? operations : [];
}

function asText(value: unknown): string {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  return String(value);
}

/** `u64` args decode to decimal strings; accept numbers too so the reader is total. */
function asIntegerString(value: unknown): string | null {
  if (typeof value === 'bigint' || typeof value === 'number') return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  return null;
}

function positiveDuration(value: unknown): number | null {
  const raw = asIntegerString(value);
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

/**
 * Extract the marketplace call from a wallet-signed XDR.
 *
 * Returns null — never throws — for anything this reader cannot fully
 * understand: unparsable XDR, a non-invocation operation, a call aimed at a
 * different contract, an unknown function, or arguments that do not match the
 * function's shape. The relay calls this on the hot path, and a listing must
 * still be submitted when our own reader is confused by it.
 */
export function readMarketplaceIntent(
  signedXdr: string,
  options: MarketplaceIntentOptions,
): MarketplaceIntent | null {
  try {
    const transaction = TransactionBuilder.fromXDR(signedXdr, options.networkPassphrase);
    const [operation] = operationsOf(transaction);
    const hostFunction = (operation as { type?: string; func?: unknown }) ?? {};
    if (hostFunction.type !== 'invokeHostFunction') return null;

    const invoke = hostFunction.func as {
      arm?: () => string;
      invokeContract?: () => InvokeArgsLike;
    };
    if (typeof invoke?.arm !== 'function' || invoke.arm() !== 'invokeContract') return null;

    const call = invoke.invokeContract?.();
    if (!call) return null;

    const address = call.contractAddress();
    if (address.arm() !== 'contractId') return null;
    const contractId = StrKey.encodeContract(address.contractId());
    if (contractId !== options.marketplaceContractId) return null;

    const functionName = asText(call.functionName());
    if (!MARKETPLACE_FUNCTIONS.includes(functionName as MarketplaceFunction)) return null;

    const args = call.args().map((value: xdr.ScVal) => scValToNative(value));
    return buildIntent(functionName as MarketplaceFunction, contractId, args);
  } catch (err) {
    logger.warn({ err }, 'Could not read a marketplace intent from the signed XDR');
    return null;
  }
}

/** Minimal shape of `InvokeContractArgs` that this SDK build exposes. */
interface InvokeArgsLike {
  contractAddress: () => { arm: () => string; contractId: () => Buffer };
  functionName: () => Buffer | string;
  args: () => xdr.ScVal[];
}

/**
 * Map each function's positional arguments onto an intent, or null when the
 * argument list does not match the contract signature.
 */
function buildIntent(
  functionName: MarketplaceFunction,
  contractId: string,
  args: unknown[],
): MarketplaceIntent | null {
  const signerAddress = typeof args[0] === 'string' ? args[0] : null;
  const tokenId = asIntegerString(args[1]);
  if (!signerAddress || !tokenId) return null;

  switch (functionName) {
    case 'list_nft': {
      const amountStroops = asIntegerString(args[2]);
      if (!amountStroops) return null;
      return { functionName, contractId, tokenId, signerAddress, amountStroops };
    }
    case 'buy_nft':
      return { functionName, contractId, tokenId, signerAddress };
    case 'place_bid': {
      const amountStroops = asIntegerString(args[2]);
      if (!amountStroops) return null;
      return { functionName, contractId, tokenId, signerAddress, amountStroops };
    }
    case 'create_auction': {
      const amountStroops = asIntegerString(args[2]);
      const durationSeconds = positiveDuration(args[3]);
      if (!amountStroops || !durationSeconds) return null;
      return {
        functionName,
        contractId,
        tokenId,
        signerAddress,
        amountStroops,
        durationSeconds,
      };
    }
    default:
      return null;
  }
}
