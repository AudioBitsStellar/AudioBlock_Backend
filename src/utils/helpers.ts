import { Response } from 'express';
import crypto from 'crypto';
import { mapToOnChainError } from '../types/OnChainErrorCodes';
import { AppError } from '../errors/AppError';
import { CircuitBreakerOpenError } from './circuitBreaker';

export function handleError(res: Response, error: unknown): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json(error.toResponseBody());
    return;
  }

  if (error instanceof CircuitBreakerOpenError) {
    res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: error.message } });
    return;
  }

  const isDev = process.env.NODE_ENV === 'development';
  const rawMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
  console.error(
    'Unhandled error in handleError:',
    rawMessage,
    error instanceof Error ? error.stack : '',
  );

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isDev ? rawMessage : 'Something went wrong',
    },
  });
}

/**
 * Specialized error handler for on-chain transaction relay endpoints.
 * Keeps OnChainErrorCode as the wire `code` and folds the retryable flag
 * into `details`, so on-chain responses conform to the same envelope as
 * every other error response.
 */
export function handleOnChainError(res: Response, error: unknown): void {
  const mapped = mapToOnChainError(error);
  console.error('On-chain Error:', mapped);

  const statusCode = mapped.retryable ? 400 : 500;
  const details: Record<string, unknown> = { retryable: mapped.retryable };
  if (mapped.details !== undefined) {
    details.cause = mapped.details;
  }

  res.status(statusCode).json({
    error: {
      code: mapped.errorCode,
      message: mapped.message,
      details,
    },
  });
}

export function base64URLEncode(str: Buffer) {
  return str.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier() {
  return base64URLEncode(crypto.randomBytes(32));
}

export function generateCodeChallenge(verifier: string) {
  return base64URLEncode(crypto.createHash('sha256').update(verifier).digest());
}
