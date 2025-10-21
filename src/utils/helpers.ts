import { ValidationError } from "class-validator";
import { IValidationFormatResult } from "../interfaces/IValidateErrorFormat";
import {Request, Response} from "express";
import crypto from "crypto";


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

export function base64URLEncode(str: Buffer) {
  return str.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generateCodeVerifier() {
  return base64URLEncode(crypto.randomBytes(32));
}

export function generateCodeChallenge(verifier: string) {
  return base64URLEncode(
    crypto.createHash("sha256").update(verifier).digest()
  );
}