import { ValidationError } from "class-validator";
import { IValidationFormatResult } from "../interfaces/IValidateErrorFormat";
import { Request, Response } from "express";
import crypto from "crypto";
import logger from "./logger";
import {
  mapToOnChainError,
  OnChainErrorCode,
} from "../types/OnChainErrorCodes";

export function formatValidationErrors(
  errors: ValidationError[],
): IValidationFormatResult {
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

export function handleError(res: Response, error: unknown): void {
  // res.log is missing when tests call controllers with bare res mocks
  const log = res.log ?? logger;
  if (error instanceof Error) {
    log.error({ err: error }, "Handled error");
    res.status(400).json({ message: error.message });
  } else if (typeof error === "string") {
    log.error({ error }, "String error");
    res.status(400).json({ message: error });
  } else {
    log.error({ error }, "Unknown error");
    res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Specialized error handler for on-chain transaction relay endpoints.
 * Returns standardized error codes and retryable flags for frontend consumption.
 */
export function handleOnChainError(res: Response, error: unknown): void {
  const errorResponse = mapToOnChainError(error);
  (res.log ?? logger).error({ errorResponse }, "On-chain error");

  // Return 400 for retryable errors, 500 for non-retryable
  const statusCode = errorResponse.retryable ? 400 : 500;
  res.status(statusCode).json(errorResponse);
}

export function base64URLEncode(str: Buffer) {
  return str
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generateCodeVerifier() {
  return base64URLEncode(crypto.randomBytes(32));
}

export function generateCodeChallenge(verifier: string) {
  return base64URLEncode(crypto.createHash("sha256").update(verifier).digest());
}
