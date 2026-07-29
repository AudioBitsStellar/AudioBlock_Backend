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

  if (error instanceof Error) {
    logRequestError(req, error, 400);
    res.status(400).json({ message: error.message });
  } else if (typeof error === 'string') {
    logRequestError(req, error, 400);
    res.status(400).json({ message: error });
  } else {
    logRequestError(req, error, 500);
    res.status(500).json({ message: 'Internal server error' });
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
