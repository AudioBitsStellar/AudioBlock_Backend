import { ValidationError } from "class-validator";
import { IValidationFormatResult } from "../interfaces/IValidateErrorFormat";
import {Request, Response} from "express";

export function formatValidationErrors(errors: ValidationError[]): IValidationFormatResult {
    const fields: Record<string, string> = {};
    const message: string[] = [];

    for (const err of errors) {
        const constraints = err.constraints || {};
        const messages = Object.values(constraints);

        if (messages.length > 0) {
            fields[err.property] = messages[0]; // First message per field
            message.push(...messages);         // All messages for `message` array
        }
    }

    return {
        success: false,
        fields,
        message
    };
}


export function handleError(res: Response, error: unknown): void {
    if (error instanceof Error) {
        console.error("Handled Error:", error.message, error.stack);
        res.status(400).json({ message: error.message });
    } else if (typeof error === 'string') {
        console.error("String Error:", error);
        res.status(400).json({ message: error });
    } else {
        console.error("Unknown Error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}