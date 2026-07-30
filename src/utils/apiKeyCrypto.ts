import crypto from 'crypto';

/**
 * API key generation and hashing utilities (Issue #89).
 *
 * Keys are only ever returned to the caller once, at creation time. The
 * database stores a SHA-256 hash, so a database leak does not expose usable
 * credentials. Lookup stays a single indexed query because hashing is
 * deterministic (unlike bcrypt, which would force a scan over every row).
 */

/** Prefix identifying an AudioBlocks API key in logs and secret scanners. */
export const API_KEY_PREFIX = 'abk';

/** Bytes of entropy in the secret portion of a key. */
const API_KEY_SECRET_BYTES = 32;

/** Characters of the raw key retained as a display hint (after the prefix). */
const API_KEY_PREVIEW_LENGTH = 8;

export interface GeneratedApiKey {
  /** Full key, e.g. `abk_<64 hex chars>`. Shown to the user exactly once. */
  rawKey: string;
  /** SHA-256 hash of `rawKey` — the only form persisted. */
  keyHash: string;
  /** Non-secret prefix stored for display, e.g. `abk_1a2b3c4d`. */
  keyPrefix: string;
}

/**
 * Generates a new API key with its hash and display prefix.
 *
 * @returns The raw key (return to caller once), its hash, and a display prefix
 */
export function generateApiKey(): GeneratedApiKey {
  const secret = crypto.randomBytes(API_KEY_SECRET_BYTES).toString('hex');
  const rawKey = `${API_KEY_PREFIX}_${secret}`;

  return {
    rawKey,
    keyHash: hashApiKey(rawKey),
    keyPrefix: `${API_KEY_PREFIX}_${secret.slice(0, API_KEY_PREVIEW_LENGTH)}`,
  };
}

/**
 * Hashes a raw API key for storage or lookup.
 *
 * @param rawKey - The full raw key, including its prefix
 * @returns Hex-encoded SHA-256 digest
 */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

/**
 * Checks that a string is shaped like an API key before it is used in a lookup.
 * Cheap rejection of obviously malformed credentials.
 *
 * @param value - Candidate key
 * @returns true when `value` has the expected prefix and hex secret length
 */
export function isApiKeyFormat(value: string): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  return new RegExp(`^${API_KEY_PREFIX}_[a-f0-9]{${API_KEY_SECRET_BYTES * 2}}$`).test(value);
}

/**
 * Constant-time comparison of two hex digests, so a caller cannot learn a
 * stored hash byte-by-byte from response timing.
 *
 * @param a - First digest
 * @param b - Second digest
 * @returns true when the digests are identical
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');

  if (bufferA.length !== bufferB.length || bufferA.length === 0) {
    return false;
  }

  return crypto.timingSafeEqual(bufferA, bufferB);
}
