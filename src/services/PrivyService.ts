import crypto from 'crypto';
import { AppError, ErrorType } from '../errors/AppError';
import { getPrivyConfig } from '../config/privy';

export interface PrivyAccessClaims {
  /** Privy user DID, e.g. did:privy:... */
  sub: string;
  /** Session id (sid claim), present on Privy access tokens. */
  sid?: string;
  aud: string;
  iss: string;
  iat: number;
  exp: number;
}

export interface PrivyMfaStatus {
  privyUserId: string;
  enrolledInMfa: boolean;
  mfaMethods: string[];
}

/** Claims present on Privy access tokens, all optional until validated. */
interface PrivyTokenClaims {
  sub?: string;
  sid?: string;
  aud?: string | string[];
  iss?: string;
  iat?: number;
  exp?: number;
}

interface PrivyUserResponse {
  id?: string;
  mfa_methods?: Array<{ type?: string }>;
}

const ALLOWED_ALGS = new Set(['ES256', 'EdDSA']);
const PRIVY_ISSUERS = new Set(['privy.io', 'https://privy.io']);
/** Tolerated clock drift when checking exp (seconds). */
const CLOCK_SKEW_SECONDS = 30;
const REQUEST_TIMEOUT_MS = 5000;

function notConfigured(message: string): AppError {
  return AppError.externalService(message, undefined, 'PRIVY_NOT_CONFIGURED');
}

function b64urlToString(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

/**
 * Convert a 64-byte raw IEEE P1363 ECDSA signature to DER/ASN.1, the
 * encoding Node's crypto.verify expects for EC keys.
 */
function rawEcdsaToDer(raw: Buffer): Buffer {
  const toInteger = (slice: Buffer): Buffer => {
    let start = 0;
    while (start < slice.length - 1 && slice[start] === 0) start++;
    let bytes = slice.subarray(start);
    if (bytes[0] & 0x80) {
      bytes = Buffer.concat([Buffer.from([0x00]), bytes]);
    }
    return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes]);
  };
  const r = toInteger(raw.subarray(0, 32));
  const s = toInteger(raw.subarray(32));
  const body = Buffer.concat([r, s]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

/**
 * Privy access-token verification and MFA queries against the Privy REST API
 * (issues #598, #639). Self-contained: no Privy SDK dependency.
 */
export class PrivyService {
  /** Allows injection of fetch for testing; defaults to global fetch. */
  private fetchFn: typeof fetch;

  constructor(fetchFn?: typeof fetch) {
    this.fetchFn = fetchFn || (global.fetch as typeof fetch);
  }

  /**
   * Verify a Privy access token: ES256/EdDSA signature against
   * PRIVY_JWT_VERIFICATION_KEY, issuer, audience (App ID), and expiry.
   * Legacy HS256 JWTs are explicitly rejected — they are verified by
   * requireAuth against JWT_SECRET, never here.
   */
  verifyAccessToken(token: string): PrivyAccessClaims {
    const parts = this.splitToken(token);
    const { header, claims } = this.decodeTokenParts(parts);
    this.verifySignature(header.alg, parts);
    return this.validateClaims(claims);
  }

  /** Split a compact JWT into [header, payload, signature], rejecting garbage. */
  private splitToken(token: string): [string, string, string] {
    if (!token) {
      throw AppError.authentication(
        'Unauthorized: No token provided',
        undefined,
        'PRIVY_TOKEN_MISSING',
      );
    }
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw AppError.authentication(
        'Unauthorized: Malformed Privy access token',
        undefined,
        'PRIVY_TOKEN_MALFORMED',
      );
    }
    return [parts[0], parts[1], parts[2]];
  }

  private decodeTokenParts(parts: [string, string, string]): {
    header: { alg?: string };
    claims: PrivyTokenClaims;
  } {
    try {
      return {
        header: JSON.parse(b64urlToString(parts[0])),
        claims: JSON.parse(b64urlToString(parts[1])),
      };
    } catch {
      throw AppError.authentication(
        'Unauthorized: Malformed Privy access token',
        undefined,
        'PRIVY_TOKEN_MALFORMED',
      );
    }
  }

  /** Verify the raw JWS signature against PRIVY_JWT_VERIFICATION_KEY. */
  private verifySignature(alg: string | undefined, parts: [string, string, string]): void {
    if (!alg || !ALLOWED_ALGS.has(alg)) {
      throw AppError.authentication(
        'Unauthorized: Unsupported token algorithm',
        undefined,
        'PRIVY_TOKEN_BAD_ALGORITHM',
      );
    }
    const key = this.loadVerificationKey();
    const signedData = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = this.normalizeSignature(alg, parts[2]);
    const verified = crypto.verify(alg === 'ES256' ? 'sha256' : null, signedData, key, signature);
    if (!verified) {
      throw AppError.authentication(
        'Unauthorized: Invalid Privy access token',
        undefined,
        'PRIVY_TOKEN_INVALID_SIGNATURE',
      );
    }
  }

  private normalizeSignature(alg: string, encoded: string): Buffer {
    const signature: Buffer = Buffer.from(encoded, 'base64url');
    if (alg !== 'ES256') {
      return signature;
    }
    // JWT signatures are raw r||s (IEEE P1363); Node expects DER for ECDSA.
    if (signature.length === 64) {
      return rawEcdsaToDer(signature);
    }
    if (signature[0] !== 0x30) {
      throw AppError.authentication(
        'Unauthorized: Invalid token signature encoding',
        undefined,
        'PRIVY_TOKEN_INVALID_SIGNATURE',
      );
    }
    return signature;
  }

  private validateClaims(claims: PrivyTokenClaims): PrivyAccessClaims {
    if (!claims.sub) {
      throw AppError.authentication(
        'Unauthorized: Token subject missing',
        undefined,
        'PRIVY_TOKEN_INVALID_SUBJECT',
      );
    }
    if (!claims.iss || !PRIVY_ISSUERS.has(claims.iss)) {
      throw AppError.authentication(
        'Unauthorized: Invalid token issuer',
        undefined,
        'PRIVY_TOKEN_INVALID_ISSUER',
      );
    }
    const audience = (
      Array.isArray(claims.aud)
        ? claims.aud.filter((value): value is string => typeof value === 'string')
        : typeof claims.aud === 'string'
          ? [claims.aud]
          : []
    ).filter((value) => value.length > 0);
    const { appId } = getPrivyConfig();
    if (!appId || !audience.includes(appId)) {
      throw AppError.authentication(
        'Unauthorized: Invalid token audience',
        undefined,
        'PRIVY_TOKEN_INVALID_AUDIENCE',
      );
    }
    const { iat, exp } = claims;
    if (typeof iat !== 'number' || typeof exp !== 'number') {
      throw AppError.authentication(
        'Unauthorized: Token timestamps missing',
        undefined,
        'PRIVY_TOKEN_INVALID_CLAIMS',
      );
    }
    if (exp + CLOCK_SKEW_SECONDS < Date.now() / 1000) {
      throw AppError.authentication(
        'Unauthorized: Token expired',
        undefined,
        'PRIVY_TOKEN_EXPIRED',
      );
    }

    return {
      sub: claims.sub,
      sid: claims.sid,
      aud: appId,
      iss: claims.iss,
      iat,
      exp,
    };
  }

  /** Current MFA enrollment for a Privy user (GET /v1/users/{id}). */
  async getMfaStatus(privyUserId: string): Promise<PrivyMfaStatus> {
    const user = await this.requestJson<PrivyUserResponse>(
      `/v1/users/${encodeURIComponent(privyUserId)}`,
    );
    const mfaMethods = (user.mfa_methods || [])
      .map((method) => method.type)
      .filter((type): type is string => typeof type === 'string' && type.length > 0);
    return {
      privyUserId: user.id || privyUserId,
      enrolledInMfa: mfaMethods.length > 0,
      mfaMethods: [...new Set(mfaMethods)],
    };
  }

  /**
   * Revoke every active session for a Privy user
   * (POST /v1/users/{id}/sessions/revoke). Used when a user loses an MFA
   * device or reports suspicious activity.
   */
  async revokeAllSessions(privyUserId: string): Promise<void> {
    const { apiUrl } = getPrivyConfig();
    const res = await this.privyFetch(
      `${apiUrl}/v1/users/${encodeURIComponent(privyUserId)}/sessions/revoke`,
      { method: 'POST' },
    );
    if (res.status === 404) {
      throw AppError.notFound('Privy user not found', undefined, 'PRIVY_USER_NOT_FOUND');
    }
    if (!res.ok) {
      throw AppError.externalService(
        `Privy API request failed with status ${res.status}`,
        { status: res.status },
        'PRIVY_API_ERROR',
      );
    }
  }

  private async requestJson<T>(path: string): Promise<T> {
    const { apiUrl } = getPrivyConfig();
    const res = await this.privyFetch(`${apiUrl}${path}`);
    if (res.status === 404) {
      throw AppError.notFound('Privy user not found', undefined, 'PRIVY_USER_NOT_FOUND');
    }
    if (!res.ok) {
      throw AppError.externalService(
        `Privy API request failed with status ${res.status}`,
        { status: res.status },
        'PRIVY_API_ERROR',
      );
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw AppError.externalService(
        'Invalid response from Privy API',
        undefined,
        'PRIVY_API_INVALID_RESPONSE',
      );
    }
  }

  private async privyFetch(url: string, init?: RequestInit): Promise<Response> {
    const { appId, appSecret } = getPrivyConfig();
    if (!appId || !appSecret) {
      throw notConfigured('Privy authentication is not configured');
    }
    const basicAuth = Buffer.from(`${appId}:${appSecret}`).toString('base64');
    try {
      return await this.fetchFn(url, {
        ...init,
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'privy-app-id': appId,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.externalService(
        'Privy API is unreachable',
        undefined,
        'PRIVY_API_UNREACHABLE',
      );
    }
  }

  /**
   * Load PRIVY_JWT_VERIFICATION_KEY as a public key. Accepts PEM,
   * base64-encoded SPKI DER, or a JWK JSON string.
   */
  private loadVerificationKey(): crypto.KeyObject {
    const { verificationKey } = getPrivyConfig();
    const raw = verificationKey.trim();
    if (!raw) {
      throw notConfigured('Privy authentication is not configured');
    }

    const parseError = (): AppError =>
      new AppError(
        'PRIVY_JWT_VERIFICATION_KEY is not a valid public key',
        ErrorType.INTERNAL_ERROR,
        500,
        true,
        undefined,
        'PRIVY_KEY_INVALID',
      );

    try {
      if (raw.startsWith('{')) {
        return crypto.createPublicKey({ key: JSON.parse(raw), format: 'jwk' });
      }
      if (raw.includes('-----BEGIN')) {
        return crypto.createPublicKey({ key: raw, format: 'pem' });
      }
      return crypto.createPublicKey({
        key: Buffer.from(raw, 'base64'),
        format: 'der',
        type: 'spki',
      });
    } catch {
      throw parseError();
    }
  }
}

export const privyService = new PrivyService();
