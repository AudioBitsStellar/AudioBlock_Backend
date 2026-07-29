/**
 * Application-wide error class for structured error handling.
 * Provides consistent error format across all services and controllers.
 */

export enum ErrorType {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  BUSINESS_LOGIC_ERROR = 'BUSINESS_LOGIC_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
}

export interface ErrorDetails {
  field?: string;
  value?: unknown;
  constraint?: string;
  [key: string]: unknown;
}

export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: ErrorDetails | ErrorDetails[];

  constructor(
    message: string,
    type: ErrorType = ErrorType.INTERNAL_ERROR,
    statusCode: number = 500,
    isOperational: boolean = true,
    details?: ErrorDetails | ErrorDetails[],
    code?: string,
  ) {
    super(message);

    this.type = type;
    this.code = code ?? type;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;

    // Maintain proper stack trace in V8 environments
    Error.captureStackTrace(this, this.constructor);

    // Set the prototype explicitly to fix instanceof checks
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static validation(
    message: string,
    details?: ErrorDetails | ErrorDetails[],
    code?: string,
  ): AppError {
    return new AppError(message, ErrorType.VALIDATION_FAILED, 400, true, details, code);
  }

  static authentication(
    message: string,
    details?: ErrorDetails | ErrorDetails[],
    code?: string,
  ): AppError {
    return new AppError(message, ErrorType.UNAUTHORIZED, 401, true, details, code);
  }

  static authorization(
    message: string,
    details?: ErrorDetails | ErrorDetails[],
    code?: string,
  ): AppError {
    return new AppError(message, ErrorType.FORBIDDEN, 403, true, details, code);
  }

  /** Alias for authorization - semantically clearer for 403 errors */
  static forbidden(
    message: string,
    details?: ErrorDetails | ErrorDetails[],
    code?: string,
  ): AppError {
    return AppError.authorization(message, details, code);
  }

  static notFound(
    message: string,
    details?: ErrorDetails | ErrorDetails[],
    code?: string,
  ): AppError {
    return new AppError(message, ErrorType.NOT_FOUND, 404, true, details, code);
  }

  static conflict(
    message: string,
    details?: ErrorDetails | ErrorDetails[],
    code?: string,
  ): AppError {
    return new AppError(message, ErrorType.CONFLICT, 409, true, details, code);
  }

  static businessLogic(
    message: string,
    details?: ErrorDetails | ErrorDetails[],
    code?: string,
  ): AppError {
    return new AppError(message, ErrorType.BUSINESS_LOGIC_ERROR, 400, true, details, code);
  }

  static externalService(
    message: string,
    details?: ErrorDetails | ErrorDetails[],
    code?: string,
  ): AppError {
    return new AppError(message, ErrorType.EXTERNAL_SERVICE_ERROR, 502, true, details, code);
  }

  static database(
    message: string,
    details?: ErrorDetails | ErrorDetails[],
    code?: string,
  ): AppError {
    return new AppError(message, ErrorType.DATABASE_ERROR, 500, true, details, code);
  }

  static rateLimited(
    message: string,
    details?: ErrorDetails | ErrorDetails[],
    code?: string,
  ): AppError {
    return new AppError(message, ErrorType.RATE_LIMITED, 429, true, details, code);
  }

  /** Standard wire format for every API error response: { error: { code, message, details? } } */
  toResponseBody(): {
    error: { code: string; message: string; details?: ErrorDetails | ErrorDetails[] };
  } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined && { details: this.details }),
      },
    };
  }
}
