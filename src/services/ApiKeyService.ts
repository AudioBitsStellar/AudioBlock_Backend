import { IsNull, Repository } from 'typeorm';
import { ApiKey, ApiKeyScope } from '../entities/ApiKey';
import { User, UserRole } from '../entities/User';
import AppDataSource from '../config/db';
import { AppError } from '../errors/AppError';
import { ERROR_MESSAGES } from '../config/constants';
import { Permission, roleHasPermission } from '../types/Permissions';
import {
  validateRequired,
  validateStringLength,
  validateUUID,
} from '../validators/ServiceValidator';
import {
  generateApiKey,
  hashApiKey,
  isApiKeyFormat,
  timingSafeEqualHex,
} from '../utils/apiKeyCrypto';

/** Maximum length of the user-supplied key name. */
const API_KEY_NAME_MAX_LENGTH = 100;

/** Maximum number of simultaneously active keys per user. */
const MAX_ACTIVE_KEYS_PER_USER = 20;

/** Rate-limit tiers assignable to a key; self-service issuance stays "standard". */
export const API_KEY_RATE_LIMIT_TIERS = ['standard', 'high', 'unlimited'] as const;
export type ApiKeyRateLimitTier = (typeof API_KEY_RATE_LIMIT_TIERS)[number];

/** An API key as returned to the client — never carries the hash. */
export interface ApiKeyView {
  id: string;
  name: string;
  keyPrefix?: string;
  scopes?: ApiKeyScope[];
  permissions: string[];
  rateLimitTier: string;
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
  private apiKeyRepo: Repository<ApiKey>;
  private userRepo: Repository<User>;

  constructor() {
    this.apiKeyRepo = AppDataSource.getRepository(ApiKey);
    this.userRepo = AppDataSource.getRepository(User);
  }

  /**
   * Issues a new API key for a user.
   *
   * The raw key is returned only here — the caller must surface it to the user
   * immediately, because only its hash is stored.
   *
   * @param userId - Owner of the key
   * @param name - Human-readable label for the key
   * @param scopes - Requested coarse-grained scopes (read-only / upload / admin)
   * @param permissions - Requested fine-grained permission strings. Rejected if
   *   any permission exceeds what the owning user's role currently holds — a
   *   key can never grant more than its owner has (enforced again on every
   *   request in {@link keyHasPermission}, so a later role downgrade also
   *   revokes it).
   * @param rateLimitTier - Rate-limit tier for the key. Self-service issuance
   *   (the public `POST /api/api-keys` route) always passes "standard"; higher
   *   tiers are only ever assigned by trusted internal callers (e.g. an admin
   *   flow), never taken directly from client input.
   * @returns The stored key view plus the one-time raw key
   */
  async createApiKey(
    userId: string,
    name: string,
    scopes: ApiKeyScope[] = [],
    permissions: string[] = [],
    rateLimitTier: ApiKeyRateLimitTier = 'standard',
  ): Promise<CreatedApiKey> {
    validateUUID(userId, 'userId');
    validateRequired(name, 'name');
    validateStringLength(name, 'name', 1, API_KEY_NAME_MAX_LENGTH);

    const user = await this.userRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw AppError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    this.assertPermissionsAllowedForRole(user.role, permissions);

    const activeKeyCount = await this.apiKeyRepo.count({
      where: { userId, revokedAt: IsNull() },
    });

    if (activeKeyCount >= MAX_ACTIVE_KEYS_PER_USER) {
      throw AppError.businessLogic(
        `API key limit reached (${MAX_ACTIVE_KEYS_PER_USER} active keys). Revoke an existing key first.`,
      );
    }

    const { rawKey, keyHash, keyPrefix } = generateApiKey();

    const apiKey = this.apiKeyRepo.create({
      userId,
      name,
      keyHash,
      keyPrefix,
      scopes,
      permissions,
      rateLimitTier,
    });

    const saved = await this.apiKeyRepo.save(apiKey);

    return { ...this.toView(saved), rawKey };
  }

  /**
   * Rejects issuance when a requested permission is either unrecognized or
   * exceeds what `role` currently holds — the "never exceed the owner's role"
   * invariant, enforced at issue time.
   */
  private assertPermissionsAllowedForRole(role: UserRole, permissions: string[]): void {
    for (const permission of permissions) {
      if (!Object.values(Permission).includes(permission as Permission)) {
        throw AppError.validation(
          `Unknown permission: ${permission}`,
          undefined,
          'INVALID_PERMISSION',
        );
      }
      if (!roleHasPermission(role, permission as Permission)) {
        throw AppError.authorization(
          `Cannot issue a key with permission "${permission}": your role does not hold it`,
          undefined,
          'PERMISSION_EXCEEDS_ROLE',
        );
      }
    }
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
   * Revokes a key the caller owns.
   *
   * @param userId - Caller, who must own the key
   * @param keyId - Key to revoke
   * @returns The revoked key view
   */
  async revokeApiKey(userId: string, keyId: string): Promise<ApiKeyView> {
    validateUUID(userId, 'userId');
    validateUUID(keyId, 'id');

    const apiKey = await this.apiKeyRepo.findOne({ where: { id: keyId } });

    if (!apiKey || apiKey.userId !== userId) {
      throw AppError.notFound('API key not found');
    }

    if (apiKey.revokedAt) {
      return this.toView(apiKey);
    }

    apiKey.revokedAt = new Date();
    const saved = await this.apiKeyRepo.save(apiKey);

    return this.toView(saved);
  }

  /**
   * Validates a raw API key and resolves the user it authenticates.
   *
   * @param rawKey - The full raw key from the request
   * @returns The key record and its owner
   */
  async validateApiKey(rawKey: string): Promise<AuthenticatedApiKey> {
    if (!isApiKeyFormat(rawKey)) {
      throw AppError.authentication('Invalid API key');
    }

    const keyHash = hashApiKey(rawKey);

    const apiKey = await this.apiKeyRepo.findOne({
      where: { keyHash },
      relations: ['user'],
    });

    if (!apiKey || !timingSafeEqualHex(apiKey.keyHash, keyHash)) {
      throw AppError.authentication('Invalid API key');
    }

    if (apiKey.revokedAt) {
      throw AppError.authentication('API key has been revoked');
    }

    if (!apiKey.user) {
      throw AppError.authentication('Associated user not found');
    }

    return { apiKey, user: apiKey.user };
  }

  /**
   * A key must be explicitly granted `requiredScope` (or `admin`, which
   * implies every scope). A key issued with no scopes holds none — it does
   * not fall back to unrestricted access.
   */
  keyHasScope(apiKey: ApiKey, requiredScope: ApiKeyScope): boolean {
    if (!apiKey.scopes || apiKey.scopes.length === 0) {
      return false;
    }
    return apiKey.scopes.includes(requiredScope) || apiKey.scopes.includes(ApiKeyScope.ADMIN);
  }

  /**
   * A permission is granted only when the key lists it AND the owning user's
   * role still holds it — so a role downgrade after issuance revokes the
   * permission immediately, without needing to touch the key itself.
   */
  keyHasPermission(apiKey: ApiKey, user: User, permission: string): boolean {
    if (!apiKey.permissions || !apiKey.permissions.includes(permission)) {
      return false;
    }
    return roleHasPermission(user.role, permission as Permission);
  }

  private toView(apiKey: ApiKey): ApiKeyView {
    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes,
      permissions: apiKey.permissions,
      rateLimitTier: apiKey.rateLimitTier,
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
      createdAt: apiKey.createdAt,
    };
  }
}
