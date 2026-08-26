import { PinataSDK } from 'pinata';
import fs from 'fs';
import { CircuitBreaker, CircuitBreakerOpenError } from '../utils/circuitBreaker';
import logger from '../config/logger';

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT || 'dummy_jwt',
  pinataGateway: process.env.PINATA_GATEWAY || 'gateway.pinata.cloud',
});

const failureThreshold = parseInt(process.env.PINATA_CB_FAILURE_THRESHOLD || '3', 10);
const resetTimeoutMs = parseInt(process.env.PINATA_CB_RESET_TIMEOUT_MS || '30000', 10);
const MAX_RETRIES = parseInt(process.env.PINATA_MAX_RETRIES || '3', 10);
const RETRY_BASE_DELAY = parseInt(process.env.PINATA_RETRY_BASE_DELAY_MS || '1000', 10);

export const pinataCircuitBreaker = new CircuitBreaker(
  async () => {
    try {
      if (!process.env.PINATA_JWT) return false;
      await pinata.testAuthentication();
      return true;
    } catch {
      return false;
    }
  },
  { failureThreshold, resetTimeoutMs },
);

async function withRetryAndCircuitBreaker<T>(
  fn: () => Promise<T>,
  maxRetries = MAX_RETRIES,
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await pinataCircuitBreaker.execute(fn);
    } catch (err: any) {
      lastError = err;
      if (err instanceof CircuitBreakerOpenError) {
        logger.error('Pinata circuit breaker is OPEN. Failing fast.');
        throw err;
      }
      logger.warn(
        { attempt, maxRetries, error: err.message || err },
        `Pinata operation failed, retrying (${attempt}/${maxRetries})`,
      );
      if (attempt < maxRetries) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

/**
 * IPFS pinning service via Pinata with circuit breaker and retry logic.
 */
export class PinataService {
  /**
   * Upload a local file to IPFS via Pinata.
   *
   * @param filePath - Absolute path to the file on disk.
   * @param fileName - Desired filename in IPFS.
   * @returns Pinata upload response with the IPFS CID.
   */
  static async uploadFile(filePath: string, fileName: string) {
    return withRetryAndCircuitBreaker(async () => {
      const file = new File([fs.readFileSync(filePath)], fileName);
      const res = await pinata.upload.public.file(file);
      return res;
    });
  }

  /**
   * Upload a JSON object to IPFS via Pinata.
   *
   * @param data - The JSON-serializable data to pin.
   * @param fileName - Desired filename in IPFS (e.g. "metadata.json").
   * @returns Pinata upload response with the IPFS CID.
   */
  static async uploadJSON(data: any, fileName: string) {
    return withRetryAndCircuitBreaker(async () => {
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const file = new File([blob], fileName);
      const res = await pinata.upload.public.file(file);
      return res;
    });
  }
}
