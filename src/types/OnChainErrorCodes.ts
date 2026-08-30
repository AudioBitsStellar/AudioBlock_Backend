/**
 * Standardized error codes for on-chain relay operations.
 * These codes provide a consistent contract between backend and frontends
 * for handling transaction failures in artist setup and song minting flows.
 */
export enum OnChainErrorCode {
  // Transaction lifecycle errors
  TRANSACTION_EXPIRED = 'TRANSACTION_EXPIRED',
  TRANSACTION_INVALID_SIGNATURE = 'TRANSACTION_INVALID_SIGNATURE',
  TRANSACTION_SEQUENCE_MISMATCH = 'TRANSACTION_SEQUENCE_MISMATCH',

  // Network and relay errors
  SOROBAN_NETWORK_ERROR = 'SOROBAN_NETWORK_ERROR',
  SOROBAN_TIMEOUT = 'SOROBAN_TIMEOUT',

  // Contract-level errors
  CONTRACT_INVOCATION_FAILED = 'CONTRACT_INVOCATION_FAILED',
  CONTRACT_REJECTED = 'CONTRACT_REJECTED',

  // Pre-flight validation errors
  WALLET_NOT_CONNECTED = 'WALLET_NOT_CONNECTED',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  METADATA_NOT_READY = 'METADATA_NOT_READY',
  ARTIST_NOT_REGISTERED = 'ARTIST_NOT_REGISTERED',

  // Generic errors
  INVALID_XDR_FORMAT = 'INVALID_XDR_FORMAT',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface OnChainErrorResponse {
  success: false;
  errorCode: OnChainErrorCode;
  message: string;
  retryable: boolean;
  details?: unknown;
}

/**
 * Rule-based error classification for mapToOnChainError (#302).
 * Each rule defines patterns to match and the resulting error response.
 * Rules are evaluated in order; first match wins.
 */
interface ErrorRule {
  patterns: RegExp[];
  allRequired?: boolean;
  errorCode: OnChainErrorCode;
  message: string;
  retryable: boolean;
}

const ERROR_RULES: ErrorRule[] = [
  {
    patterns: [/expired|too late/i],
    errorCode: OnChainErrorCode.TRANSACTION_EXPIRED,
    message: 'Transaction has expired. Please retry to generate a fresh transaction.',
    retryable: true,
  },
  {
    patterns: [/signature/i, /invalid|bad/i],
    allRequired: true,
    errorCode: OnChainErrorCode.TRANSACTION_INVALID_SIGNATURE,
    message: 'Transaction signature is invalid. Please sign again with your wallet.',
    retryable: true,
  },
  {
    patterns: [/sequence|bad_seq/i],
    errorCode: OnChainErrorCode.TRANSACTION_SEQUENCE_MISMATCH,
    message: 'Transaction sequence number is out of sync. Please retry.',
    retryable: true,
  },
  {
    patterns: [/timeout|timed out/i],
    errorCode: OnChainErrorCode.SOROBAN_TIMEOUT,
    message: 'Network request timed out. Please check your connection and retry.',
    retryable: true,
  },
  {
    patterns: [/soroban|horizon|network/i],
    errorCode: OnChainErrorCode.SOROBAN_NETWORK_ERROR,
    message: 'Stellar network error occurred. Please retry in a moment.',
    retryable: true,
  },
  {
    patterns: [/contract/i, /failed/i],
    allRequired: true,
    errorCode: OnChainErrorCode.CONTRACT_INVOCATION_FAILED,
    message: 'Smart contract invocation failed. Please contact support if this persists.',
    retryable: false,
  },
  {
    patterns: [/wallet/i],
    errorCode: OnChainErrorCode.WALLET_NOT_CONNECTED,
    message: 'Stellar wallet not connected. Please connect your wallet first.',
    retryable: false,
  },
  {
    patterns: [/metadata|cid/i],
    errorCode: OnChainErrorCode.METADATA_NOT_READY,
    message: 'Metadata is not ready for minting. Please wait for processing to complete.',
    retryable: false,
  },
  {
    patterns: [/xdr/i, /invalid|malformed/i],
    allRequired: true,
    errorCode: OnChainErrorCode.INVALID_XDR_FORMAT,
    message: 'Transaction format is invalid. Please retry from the beginning.',
    retryable: true,
  },
];

/**
 * Check if an error message matches a rule's patterns.
 */
function matchesRule(message: string, rule: ErrorRule): boolean {
  if (rule.allRequired) {
    return rule.patterns.every((p) => p.test(message));
  }
  return rule.patterns.some((p) => p.test(message));
}

/**
 * Maps an error to a standardized OnChainErrorResponse.
 * Frontends can use errorCode for branching logic and retryable flag
 * to determine UX (show retry button vs. fatal error).
 *
 * Refactored (#302): complexity reduced from 24 to ~8 using rule table.
 */
export function mapToOnChainError(error: unknown): OnChainErrorResponse {
  const errorMessage = error instanceof Error ? error.message : String(error);

  for (const rule of ERROR_RULES) {
    if (matchesRule(errorMessage, rule)) {
      return {
        success: false,
        errorCode: rule.errorCode,
        message: rule.message,
        retryable: rule.retryable,
        details: errorMessage,
      };
    }
  }

  return {
    success: false,
    errorCode: OnChainErrorCode.UNKNOWN_ERROR,
    message: 'An unexpected error occurred. Please retry or contact support.',
    retryable: true,
    details: errorMessage,
  };
}
