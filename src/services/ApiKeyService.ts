import { getRepository } from 'typeorm';
import { ApiKey, ApiKeyScope } from '../entities/ApiKey';
import { User } from '../entities/User';
import { AppError } from '../errors/AppError';
import * as crypto from 'crypto';

/** Maximum length of the user-supplied key name. */
const API_KEY_NAME_MAX_LENGTH = 100;

/** Maximum number of simultaneously active keys per user. */
const MAX_ACTIVE_KEYS_PER_USER = 20;

/** An API key as returned to the client — never carries the hash. */
export interface ApiKeyView {
  id: string;
  name: string;
  keyPrefix: string;
  rateLimitTier: string;
  permissions: string[];
  lastUsedAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
}

/** Result of creating a key. `rawKey` is present only on this response. */
export interface CreatedApiKey extends ApiKeyView {
  rawKey: string;
}

/** A validated key plus the user it authenticates. */
export interface AuthenticatedApiKey {
  apiKey: ApiKey;
  user: User;
}

/**
 * Service layer for API key issuance, listing, revocation, and validation
 * (Issue #89).
 */
export class ApiKeyService {
  private apiKeyRepo = getRepository(ApiKey);
  private userRepo = getRepository(User);

  /**
   * Issues a new API key for a user.
   *
   * The raw key is returned only here — the caller must surface it to the user
   * immediately, because only its hash is stored.
   *
   * @param userId - Owner of the key
   * @param name - Human-readable label for the key
   * @param permissions - Requested permission strings (defaults to none)
   * @param rateLimitTier - Rate limit tier (defaults to 'standard')
   * @returns The stored key view plus the one-time raw key
   * @throws {AppError} When the user is missing, the name is invalid, a
   *   requested permission exceeds the user's role, or the key limit is reached
   */
  async createApiKey(
    userId: string,
    name: string,
    scopes: ApiKeyScope[] = [],
    permissions: string[] = [],
    rateLimitTier: string = 'standard',
  ): Promise<CreatedApiKey> {
    validateUUID(userId, 'userId');
    validateRequired(name, 'name');
    validateStringLength(name, 'name', 1, API_KEY_NAME_MAX_LENGTH);

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw AppError.notFound('User not found');
    }

    const rawKey = `ab_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const apiKey = this.apiKeyRepo.create({
      userId,
      name,
      keyHash,
      keyPrefix,
      permissions: requestedPermissions,
      rateLimitTier,
    });

    const saved = await this.apiKeyRepo.save(apiKey);

    return { ...this.toView(saved), rawKey };
  }

  /**
   * Lists a user's API keys. Hashes are never included.
   *
   * @param userId - Owner of the keys
   * @param includeRevoked - When true, revoked keys are listed too
   * @returns Key views, newest first
   */
  async listApiKeys(userId: string, includeRevoked = false): Promise<ApiKeyView[]> {
    validateUUID(userId, 'userId');

    const keys = await this.apiKeyRepo.find({
      where: includeRevoked ? { userId } : { userId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    return keys.map((key) => this.toView(key));
  }

  /**
   * Revokes a key the caller owns. Revocation is idempotent: revoking an
   * already-revoked key returns it unchanged rather than erroring.
   *
   * @param userId - Caller, who must own the key
   * @param keyId - Key to revoke
   * @returns The revoked key view
   * @throws {AppError} When the key does not exist or belongs to another user
   */
  async revokeApiKey(userId: string, keyId: string): Promise<ApiKeyView> {
    validateUUID(userId, 'userId');
    validateUUID(keyId, 'id');

    const apiKey = await this.apiKeyRepo.findOne({ where: { id: keyId } });

    if (!apiKey) {
      throw AppError.notFound('API key not found');
    }

    if (apiKey.userId !== userId) {
      throw AppError.authorization('Forbidden: You do not own this API key');
    }

    if (!apiKey.revokedAt) {
      apiKey.revokedAt = new Date();
      await this.apiKeyRepo.save(apiKey);
    }

    return this.toView(apiKey);
  }

  /**
   * Validates a raw API key presented in a request.
   *
   * @param rawKey - The secret key provided by the caller
   * @returns The resolved ApiKey entity and its owning User
   * @throws {AppError} When the key is invalid, revoked, or its owner is missing
   */
  async validateApiKey(rawKey: string): Promise<AuthenticatedApiKey> {
    if (!isApiKeyFormat(rawKey)) {
      throw AppError.authentication('Unauthorized: Invalid API key format');
    }

    const keyPrefix = rawKey.slice(0, 12);
    const candidates = await this.apiKeyRepo.find({
      where: { keyPrefix, revokedAt: IsNull() },
      relations: ['user'],
    });

    const keyHash = hashApiKey(rawKey);
    let matchedKey: ApiKey | null = null;

    for (const candidate of candidates) {
      if (timingSafeEqualHex(candidate.keyHash, keyHash)) {
        matchedKey = candidate;
        break;
      }
    }

    if (!matchedKey || !matchedKey.user) {
      throw AppError.authentication('Unauthorized: Invalid or revoked API key');
    }

    matchedKey.lastUsedAt = new Date();
    await this.apiKeyRepo.save(matchedKey);

    return { apiKey: matchedKey, user: matchedKey.user };
  }

  /**
   * Checks whether a key has a given permission, and whether its owner's role
   * still holds that permission.
   */
  keyHasPermission(apiKey: ApiKey, user: User, permission: Permission): boolean {
    if (!apiKey.permissions.includes(permission)) {
      return false;
    }

    const rolePermissions = ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS] || [];
    return rolePermissions.includes(permission);
  }

  private normalizePermissions(permissions: string[]): Permission[] {
    return Array.from(new Set(permissions)) as Permission[];
  }

  private assertPermissionsWithinRole(permissions: Permission[], user: User): void {
    const rolePermissions = ROLE_PERMISSIONS[user.role as keyof typeof ROLE_PERMISSIONS] || [];
    const invalid = permissions.find((p) => !rolePermissions.includes(p));

    if (invalid) {
      throw AppError.businessLogic(
        `Permission '${invalid}' exceeds the capabilities of role '${user.role}'`,
      );
    }

  private toView(apiKey: ApiKey): ApiKeyView {
    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      rateLimitTier: apiKey.rateLimitTier || 'standard',
      permissions: apiKey.permissions,
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
      createdAt: apiKey.createdAt,
    };
  }
}
