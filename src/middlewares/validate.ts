import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppError } from '../errors/AppError';
import { handleError } from '../utils/helpers';

export function validateDTO(DTOClass: any) {
  return async (req: any, res: any, next: any) => {
    try {
      const dto = plainToInstance(DTOClass, req.body);
      const errors = await validate(dto, { whitelist: true });

      if (errors.length > 0) {
        const details = errors.map((err) => ({
          field: err.property,
          message: Object.values(err.constraints || {}).join(', '),
        }));

        return handleError(res, AppError.validation('Validation failed', details));
      }

      req.body = dto;
      next();
    } catch (err) {
      console.error('Validation Middleware Error:', err);
      return handleError(res, err);
    }
  };
}
