/**
 * Application-wide error class for structured error handling.
 * Provides consistent error format across all services and controllers.
 */

export enum ErrorType {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  AUTHENTICATION_ERROR = "AUTHENTICATION_ERROR",
  AUTHORIZATION_ERROR = "AUTHORIZATION_ERROR",
  NOT_FOUND_ERROR = "NOT_FOUND_ERROR",
  CONFLICT_ERROR = "CONFLICT_ERROR",
  BUSINESS_LOGIC_ERROR = "BUSINESS_LOGIC_ERROR",
  EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export interface ErrorDetails {
  field?: string;
  value?: unknown;
  constraint?: string;
  [key: string]: unknown;
}

export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: ErrorDetails;

  constructor(
    message: string,
    type: ErrorType = ErrorType.INTERNAL_ERROR,
    statusCode: number = 500,
    isOperational: boolean = true,
    details?: ErrorDetails,
  ) {
    super(message);

    this.type = type;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;

    // Maintain proper stack trace in V8 environments
    Error.captureStackTrace(this, this.constructor);

    // Set the prototype explicitly to fix instanceof checks
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /**
   * Create a validation error
   */
  static validation(message: string, details?: ErrorDetails): AppError {
    return new AppError(
      message,
      ErrorType.VALIDATION_ERROR,
      400,
      true,
      details,
    );
  }

  /**
   * Create an authentication error
   */
  static authentication(message: string, details?: ErrorDetails): AppError {
    return new AppError(
      message,
      ErrorType.AUTHENTICATION_ERROR,
      401,
      true,
      details,
    );
  }

  /**
   * Create an authorization error
   */
  static authorization(message: string, details?: ErrorDetails): AppError {
    return new AppError(
      message,
      ErrorType.AUTHORIZATION_ERROR,
      403,
      true,
      details,
    );
  }

  /**
   * Create a not found error
   */
  static notFound(message: string, details?: ErrorDetails): AppError {
    return new AppError(message, ErrorType.NOT_FOUND_ERROR, 404, true, details);
  }

  /**
   * Create a conflict error
   */
  static conflict(message: string, details?: ErrorDetails): AppError {
    return new AppError(message, ErrorType.CONFLICT_ERROR, 409, true, details);
  }

  /**
   * Create a business logic error
   */
  static businessLogic(message: string, details?: ErrorDetails): AppError {
    return new AppError(
      message,
      ErrorType.BUSINESS_LOGIC_ERROR,
      400,
      true,
      details,
    );
  }

  /**
   * Create an external service error
   */
  static externalService(message: string, details?: ErrorDetails): AppError {
    return new AppError(
      message,
      ErrorType.EXTERNAL_SERVICE_ERROR,
      502,
      true,
      details,
    );
  }

  /**
   * Create a database error
   */
  static database(message: string, details?: ErrorDetails): AppError {
    return new AppError(message, ErrorType.DATABASE_ERROR, 500, true, details);
  }

  /**
   * Convert to JSON representation
   */
  toJSON() {
    return {
      error: {
        type: this.type,
        message: this.message,
        statusCode: this.statusCode,
        details: this.details,
      },
    };
  }
}
