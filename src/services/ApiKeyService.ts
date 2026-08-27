import { getRepository } from 'typeorm';
import { ApiKey, ApiKeyScope } from '../entities/ApiKey';
import { User } from '../entities/User';
import { AppError } from '../errors/AppError';
import * as crypto from 'crypto';

export class ApiKeyService {
  private apiKeyRepo = getRepository(ApiKey);
  private userRepo = getRepository(User);

  async createApiKey(
    userId: string,
    name: string,
    scopes: ApiKeyScope[] = [],
    permissions: string[] = [],
  ): Promise<{ apiKey: ApiKey; rawKey: string }> {
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
      scopes: scopes.length > 0 ? scopes : [ApiKeyScope.READ_ONLY],
      permissions,
      isRevoked: false,
    });

    await this.apiKeyRepo.save(apiKey);

    return { apiKey, rawKey };
  }

  async validateApiKey(rawKey: string): Promise<{ apiKey: ApiKey; user: User }> {
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await this.apiKeyRepo.findOne({
      where: { keyHash, isRevoked: false },
      relations: ['user'],
    });

    if (!apiKey) {
      throw AppError.authentication('Invalid or revoked API key');
    }

    apiKey.lastUsedAt = new Date();
    await this.apiKeyRepo.save(apiKey);

    return { apiKey, user: apiKey.user };
  }

  keyHasScope(apiKey: ApiKey, requiredScope: ApiKeyScope): boolean {
    if (!apiKey.scopes) {
      return false;
    }
    if (apiKey.scopes.includes(ApiKeyScope.ADMIN)) {
      return true;
    }
    return apiKey.scopes.includes(requiredScope);
  }

  keyHasPermission(apiKey: ApiKey, user: User, permission: string): boolean {
    if (apiKey.scopes && apiKey.scopes.includes(ApiKeyScope.ADMIN)) {
      return true;
    }
    if (apiKey.permissions && apiKey.permissions.includes(permission)) {
      return true;
    }
    return false;
  }

  async listApiKeys(userId: string, includeRevoked = false): Promise<ApiKey[]> {
    const query: any = { userId };
    if (!includeRevoked) {
      query.isRevoked = false;
    }
    return this.apiKeyRepo.find({ where: query, order: { createdAt: 'DESC' } });
  }

  async revokeApiKey(userId: string, id: string): Promise<ApiKey> {
    const apiKey = await this.apiKeyRepo.findOne({ where: { id, userId } });
    if (!apiKey) {
      throw AppError.notFound('API key not found');
    }

    apiKey.isRevoked = true;
    await this.apiKeyRepo.save(apiKey);
    return apiKey;
  }
}
