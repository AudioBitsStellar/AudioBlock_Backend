/**
 * Standardized error codes for on-chain relay operations.
 * These codes provide a consistent contract between backend and frontends
 * for handling transaction failures in artist setup and song minting flows.
 */
export enum OnChainErrorCode {
  // Transaction lifecycle errors
  TRANSACTION_EXPIRED = "TRANSACTION_EXPIRED",
  TRANSACTION_INVALID_SIGNATURE = "TRANSACTION_INVALID_SIGNATURE",
  TRANSACTION_SEQUENCE_MISMATCH = "TRANSACTION_SEQUENCE_MISMATCH",

  // Network and relay errors
  SOROBAN_NETWORK_ERROR = "SOROBAN_NETWORK_ERROR",
  SOROBAN_TIMEOUT = "SOROBAN_TIMEOUT",

  // Contract-level errors
  CONTRACT_INVOCATION_FAILED = "CONTRACT_INVOCATION_FAILED",
  CONTRACT_REJECTED = "CONTRACT_REJECTED",

  // Pre-flight validation errors
  WALLET_NOT_CONNECTED = "WALLET_NOT_CONNECTED",
  INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",
  METADATA_NOT_READY = "METADATA_NOT_READY",
  ARTIST_NOT_REGISTERED = "ARTIST_NOT_REGISTERED",

  // Generic errors
  INVALID_XDR_FORMAT = "INVALID_XDR_FORMAT",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

export interface OnChainErrorResponse {
  success: false;
  errorCode: OnChainErrorCode;
  message: string;
  retryable: boolean;
  details?: unknown;
}

/**
 * Maps an error to a standardized OnChainErrorResponse.
 * Frontends can use errorCode for branching logic and retryable flag
 * to determine UX (show retry button vs. fatal error).
 */
export function mapToOnChainError(error: unknown): OnChainErrorResponse {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerMessage = errorMessage.toLowerCase();

  // Transaction expiration detection
  if (lowerMessage.includes("expired") || lowerMessage.includes("too late")) {
    return {
      success: false,
      errorCode: OnChainErrorCode.TRANSACTION_EXPIRED,
      message:
        "Transaction has expired. Please retry to generate a fresh transaction.",
      retryable: true,
      details: errorMessage,
    };
  }

  // Signature validation errors
  if (
    lowerMessage.includes("signature") &&
    (lowerMessage.includes("invalid") || lowerMessage.includes("bad"))
  ) {
    return {
      success: false,
      errorCode: OnChainErrorCode.TRANSACTION_INVALID_SIGNATURE,
      message:
        "Transaction signature is invalid. Please sign again with your wallet.",
      retryable: true,
      details: errorMessage,
    };
  }

  // Sequence number mismatch
  if (lowerMessage.includes("sequence") || lowerMessage.includes("bad_seq")) {
    return {
      success: false,
      errorCode: OnChainErrorCode.TRANSACTION_SEQUENCE_MISMATCH,
      message: "Transaction sequence number is out of sync. Please retry.",
      retryable: true,
      details: errorMessage,
    };
  }

  // Network timeouts
  if (lowerMessage.includes("timeout") || lowerMessage.includes("timed out")) {
    return {
      success: false,
      errorCode: OnChainErrorCode.SOROBAN_TIMEOUT,
      message:
        "Network request timed out. Please check your connection and retry.",
      retryable: true,
      details: errorMessage,
    };
  }

  // Generic Soroban network errors
  if (
    lowerMessage.includes("soroban") ||
    lowerMessage.includes("horizon") ||
    lowerMessage.includes("network")
  ) {
    return {
      success: false,
      errorCode: OnChainErrorCode.SOROBAN_NETWORK_ERROR,
      message: "Stellar network error occurred. Please retry in a moment.",
      retryable: true,
      details: errorMessage,
    };
  }

  // Contract invocation failures
  if (lowerMessage.includes("contract") && lowerMessage.includes("failed")) {
    return {
      success: false,
      errorCode: OnChainErrorCode.CONTRACT_INVOCATION_FAILED,
      message:
        "Smart contract invocation failed. Please contact support if this persists.",
      retryable: false,
      details: errorMessage,
    };
  }

  // Wallet connection errors
  if (
    lowerMessage.includes("wallet") ||
    (lowerMessage.includes("stellar") && lowerMessage.includes("not"))
  ) {
    return {
      success: false,
      errorCode: OnChainErrorCode.WALLET_NOT_CONNECTED,
      message:
        "Stellar wallet not connected. Please connect your wallet first.",
      retryable: false,
      details: errorMessage,
    };
  }

  // Metadata errors
  if (lowerMessage.includes("metadata") || lowerMessage.includes("cid")) {
    return {
      success: false,
      errorCode: OnChainErrorCode.METADATA_NOT_READY,
      message:
        "Metadata is not ready for minting. Please wait for processing to complete.",
      retryable: false,
      details: errorMessage,
    };
  }

  // XDR format errors
  if (
    lowerMessage.includes("xdr") &&
    (lowerMessage.includes("invalid") || lowerMessage.includes("malformed"))
  ) {
    return {
      success: false,
      errorCode: OnChainErrorCode.INVALID_XDR_FORMAT,
      message:
        "Transaction format is invalid. Please retry from the beginning.",
      retryable: true,
      details: errorMessage,
    };
  }

  // Default unknown error
  return {
    success: false,
    errorCode: OnChainErrorCode.UNKNOWN_ERROR,
    message: "An unexpected error occurred. Please retry or contact support.",
    retryable: true,
    details: errorMessage,
  };
}
