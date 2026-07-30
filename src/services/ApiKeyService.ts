import { IsNull, Repository } from 'typeorm';
import { ApiKey } from '../entities/ApiKey';
import { User } from '../entities/User';
import AppDataSource from '../config/db';
import { AppError } from '../errors/AppError';
import { ERROR_MESSAGES } from '../config/constants';
import {
  validateRequired,
  validateStringLength,
  validateUUID,
} from '../validators/ServiceValidator';
import { Permission, ROLE_PERMISSIONS } from '../types/Permissions';
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

/** An API key as returned to the client — never carries the hash. */
export interface ApiKeyView {
  id: string;
  name: string;
  keyPrefix: string;
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
   * @param permissions - Requested permission strings (defaults to none)
   * @returns The stored key view plus the one-time raw key
   * @throws {AppError} When the user is missing, the name is invalid, a
   *   requested permission exceeds the user's role, or the key limit is reached
   */
  async createApiKey(
    userId: string,
    name: string,
    permissions: string[] = [],
  ): Promise<CreatedApiKey> {
    validateUUID(userId, 'userId');
    validateRequired(name, 'name');
    validateStringLength(name, 'name', 1, API_KEY_NAME_MAX_LENGTH);

    const user = await this.userRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw AppError.notFound(ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const requestedPermissions = this.normalizePermissions(permissions);
    this.assertPermissionsWithinRole(requestedPermissions, user);

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
      permissions: requestedPermissions,
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

    if (!apiKey || apiKey.userId !== userId) {
      // Same response whether the key is missing or owned by someone else, so
      // a caller cannot probe for other users' key ids.
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
   * @throws {AppError} When the key is malformed, unknown, revoked, or its
   *   owner no longer exists
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

    // Re-compare in constant time: the indexed lookup above is an equality
    // match, this guards against a partial/timing-observable comparison path.
    if (!apiKey || !timingSafeEqualHex(apiKey.keyHash, keyHash)) {
      throw AppError.authentication('Invalid API key');
    }

    if (apiKey.revokedAt) {
      throw AppError.authentication('API key has been revoked');
    }

    if (!apiKey.user) {
      throw AppError.authentication('Invalid API key');
    }

    // Best-effort usage stamp; a failure here must not reject a valid request.
    this.apiKeyRepo.update({ id: apiKey.id }, { lastUsedAt: new Date() }).catch(() => undefined);

    return { apiKey, user: apiKey.user };
  }

  /**
   * True when a key grants `permission`, and its owner's role still does too.
   * Checking both means demoting a user immediately narrows their keys.
   *
   * @param apiKey - The authenticated key
   * @param user - The key's owner
   * @param permission - Permission being checked
   */
  keyHasPermission(apiKey: ApiKey, user: User, permission: Permission): boolean {
    const granted = apiKey.permissions ?? [];

    if (!granted.includes(permission)) {
      return false;
    }

    return (ROLE_PERMISSIONS[user.role] ?? []).includes(permission);
  }

  /** Strips duplicates and empty entries from a requested permission list. */
  private normalizePermissions(permissions: string[]): string[] {
    if (!Array.isArray(permissions)) {
      throw AppError.validation('permissions must be an array of permission strings', {
        field: 'permissions',
      });
    }

    return [...new Set(permissions.filter((permission) => typeof permission === 'string'))];
  }

  /**
   * Rejects a key request that asks for more than the user's role holds — a
   * key must never be a privilege-escalation path.
   */
  private assertPermissionsWithinRole(permissions: string[], user: User): void {
    const allValues = Object.values(Permission) as string[];
    const unknown = permissions.filter((permission) => !allValues.includes(permission));

    if (unknown.length > 0) {
      throw AppError.validation(`Unknown permissions: ${unknown.join(', ')}`, {
        field: 'permissions',
        value: unknown,
      });
    }

    const rolePermissions = (ROLE_PERMISSIONS[user.role] ?? []) as string[];
    const exceeded = permissions.filter((permission) => !rolePermissions.includes(permission));

    if (exceeded.length > 0) {
      throw AppError.authorization(
        `Your role cannot grant these permissions: ${exceeded.join(', ')}`,
        { field: 'permissions', value: exceeded },
      );
    }
  }

  /** Maps an entity to its safe wire representation (no hash). */
  private toView(apiKey: ApiKey): ApiKeyView {
    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      permissions: apiKey.permissions ?? [],
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
      createdAt: apiKey.createdAt,
    };
  }
}
