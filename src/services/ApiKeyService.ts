import AppDataSource from '../config/db';
import { ApiKey } from '../entities/ApiKey';
import { User } from '../entities/User';
import { Permission } from '../types/Permissions';
import { AppError } from '../errors/AppError';
import crypto from 'crypto';

export class ApiKeyService {
  private apiKeyRepository = AppDataSource.getRepository(ApiKey);
  private userRepository = AppDataSource.getRepository(User);

  async createApiKey(userId: string, name: string, permissions: string[] = [], scopes: string[] = []): Promise<{ apiKey: ApiKey; rawKey: string }> {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) {
      throw AppError.notFound('User not found');
    }

    const rawKey = 'ab_' + crypto.randomBytes(32).toString('hex');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.slice(0, 8);

    const apiKey = this.apiKeyRepository.create({
      userId,
      name,
      keyHash,
      keyPrefix,
      permissions,
      scopes,
      isRevoked: false,
    });

    const saved = await this.apiKeyRepository.save(apiKey);
    return { apiKey: saved, rawKey };
  }

  async validateApiKey(rawKey: string): Promise<{ apiKey: ApiKey; user: User }> {
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const apiKey = await this.apiKeyRepository.findOne({ where: { keyHash }, relations: ['user'] });

    if (!apiKey || apiKey.isRevoked) {
      throw AppError.authentication('Invalid or revoked API key');
    }

    apiKey.lastUsedAt = new Date();
    await this.apiKeyRepository.save(apiKey);

    return { apiKey, user: apiKey.user };
  }

  keyHasPermission(apiKey: ApiKey, user: User, permission: Permission): boolean {
    if (apiKey.permissions && apiKey.permissions.includes(permission)) {
      return true;
    }
    if (apiKey.scopes && apiKey.scopes.includes(permission)) {
      return true;
    }
    if (user.role === 'admin' || user.role === 'super_admin') {
      return true;
    }
    return false;
  }

  async listApiKeys(userId: string, includeRevoked = false): Promise<ApiKey[]> {
    const where: any = { userId };
    if (!includeRevoked) {
      where.isRevoked = false;
    }
    return this.apiKeyRepository.find({ where, order: { createdAt: 'DESC' } });
  }

  async revokeApiKey(userId: string, keyId: string): Promise<ApiKey> {
    const apiKey = await this.apiKeyRepository.findOneBy({ id: keyId, userId });
    if (!apiKey) {
      throw AppError.notFound('API key not found');
    }
    apiKey.isRevoked = true;
    return this.apiKeyRepository.save(apiKey);
  }
}
