import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

export function validateDTO(DTOClass: any) {
  return async (req:any, res: any, next: any) => {
    try {
      const dto = plainToInstance(DTOClass, req.body);
      const errors = await validate(dto, { whitelist: true });

      if (errors.length > 0) {
        const formattedErrors = errors.map(err => ({
          field: err.property,
          message: Object.values(err.constraints || {}).join(', '),
        }));

        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: formattedErrors,
        });
      }

      req.body = dto;
      next();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
      console.error("Validation Middleware Error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal validation error.",
        error: errorMessage,
      });
    }
  };
}
