import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { AppError } from '../errors/AppError';
import { handleError } from '../utils/helpers';

export interface FieldValidationErrorDetail {
  field: string;
  message: string;
  value?: unknown;
}

/**
 * Recursively formats class-validator ValidationError objects into flat field-level details.
 * Supports dot notation for nested objects (e.g. "artist.name" or "items.0.title").
 * Includes original value in development mode only (process.env.NODE_ENV === 'development').
 */
export function formatValidationErrors(
  errors: ValidationError[],
  parentPath = '',
  isDev = process.env.NODE_ENV === 'development',
): FieldValidationErrorDetail[] {
  const details: FieldValidationErrorDetail[] = [];

  for (const err of errors) {
    const fieldPath = parentPath ? `${parentPath}.${err.property}` : err.property;

    if (err.constraints && Object.keys(err.constraints).length > 0) {
      const message = Object.values(err.constraints).join(', ');
      const detail: FieldValidationErrorDetail = {
        field: fieldPath,
        message,
      };

      if (isDev) {
        detail.value = err.value;
      }

      details.push(detail);
    }

    if (err.children && err.children.length > 0) {
      details.push(...formatValidationErrors(err.children, fieldPath, isDev));
    }
  }

  return details;
}

export function validateDTO(DTOClass: any) {
  return async (req: any, res: any, next: any) => {
    try {
      const dto = plainToInstance(DTOClass, req.body || {});
      const errors = await validate(dto as object, { whitelist: true });

      if (errors.length > 0) {
        const details = formatValidationErrors(errors);
        return handleError(req, res, AppError.validation('Validation failed', details));
      }

      req.body = dto;
      next();
    } catch (err) {
      console.error('Validation Middleware Error:', err);
      return handleError(req, res, err);
    }
  };
}
