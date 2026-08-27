import { Request, Response } from 'express';
import { ValidationError } from 'class-validator';
import crypto from 'crypto';
import { mapToOnChainError } from '../types/OnChainErrorCodes';
import { AppError } from '../errors/AppError';
import { logRequestError } from './errorLogger';

/** Shape returned by {@link formatValidationErrors}. */
interface IValidationFormatResult {
  success: false;
  fields: Record<string, string>;
  message: string[];
}

export function formatValidationErrors(errors: ValidationError[]): IValidationFormatResult {
  const fields: Record<string, string> = {};
  const message: string[] = [];

  for (const err of errors) {
    const constraints = err.constraints || {};
    const messages = Object.values(constraints);

    if (messages.length > 0) {
      fields[err.property] = messages[0]; // First message per field
      message.push(...messages); // All messages for `message` array
    }
  }

  return {
    success: false,
    fields,
    message,
  };
}

/**
 * Sends the standard error-response shape documented in
 * docs/conventions.md — `{ success: false, message, type, details? }` —
 * for every error case, not just `AppError` (issue #325).
 *
 * Previously, non-`AppError` branches sent a differently-shaped
 * `{ message }` payload *and then fell through* to an unconditional
 * `res.status(500).json({ error: { code, message } })` at the end of the
 * function with no `return` in between — every non-`AppError` call sent
 * two responses on the same `res`, which throws
 * `ERR_HTTP_HEADERS_SENT` on the second `.json()` call. Each branch below
 * now returns immediately after sending its one response.
 */
export function handleError(arg1: any, arg2: any, arg3?: any): void {
  let req: any = null;
  let res: Response;
  let error: unknown;

  if (arg3 !== undefined) {
    req = arg1;
    res = arg2;
    error = arg3;
  } else {
    res = arg1;
    error = arg2;
  }

  // Handle AppError with structured response
  if (error instanceof AppError) {
    logRequestError(req, error, error.statusCode);
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      type: error.type,
      ...(error.details && { details: error.details }),
    });
    return;
  }

  const isDev = process.env.NODE_ENV === 'development';

  if (error instanceof Error) {
    logRequestError(req, error, 400);
    res.status(400).json({
      success: false,
      message: isDev ? error.message : 'Bad request',
      type: 'BAD_REQUEST',
    });
    return;
  }

  if (typeof error === 'string') {
    logRequestError(req, error, 400);
    res.status(400).json({ success: false, message: error, type: 'BAD_REQUEST' });
    return;
  }

  logRequestError(req, error, 500);
  console.error('Unhandled error in handleError:', error);
  res.status(500).json({
    success: false,
    message: isDev ? 'Internal server error' : 'Something went wrong',
    type: 'INTERNAL_ERROR',
  });
}

/**
 * Specialized error handler for on-chain transaction relay endpoints.
 * Keeps OnChainErrorCode as the wire `code` and folds the retryable flag
 * into `details`, so on-chain responses conform to the same envelope as
 * every other error response.
 */
export function handleOnChainError(req: Request, res: Response, error: unknown): void {
  const errorResponse = mapToOnChainError(error);

  // Return 400 for retryable errors, 500 for non-retryable
  const statusCode = errorResponse.retryable ? 400 : 500;
  logRequestError(req, error, statusCode);
  res.status(statusCode).json(errorResponse);
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
