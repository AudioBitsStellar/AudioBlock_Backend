import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from "class-validator";

export function MaxFileSize(maxSizeInBytes: number, validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: "MaxFileSize",
      target: object.constructor,
      propertyName,
      constraints: [maxSizeInBytes],
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          // If no file provided, skip validation
          if (!value) return true;

          // If the value is an object (e.g. Multer file)
          if (typeof value === "object" && "size" in value) {
            return value.size <= args.constraints[0];
          }

          // Otherwise, assume invalid
          return false;
        },
        defaultMessage(args: ValidationArguments) {
          const maxSize = args.constraints[0] / (1024 * 1024);
          return `File size for ${args.property} must not exceed ${maxSize}MB`;
        },
      },
    });
  };
}

export function IsImageFile(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: "IsImageFile",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          if (!value) return true;
          const allowed = ["image/jpeg", "image/png", "image/jpg"];
          return allowed.includes(value.mimetype);
        },
        defaultMessage() {
          return "File must be an image (jpg or png)";
        },
      },
    });
  };
}