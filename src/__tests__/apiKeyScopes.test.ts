import 'reflect-metadata';
import { ApiKeyService } from '../services/ApiKeyService';
import { ApiKey, ApiKeyScope } from '../entities/ApiKey';
import { User, UserRole } from '../entities/User';
import { Permission } from '../types/Permissions';

// Test suite for API key scope validation and permission enforcement
describe('ApiKey scopes and permissions enforcement', () => {
  let apiKeyService: ApiKeyService;

  beforeEach(() => {
    apiKeyService = new ApiKeyService();
  });

  describe('keyHasScope', () => {
    it('grants a scope the key was explicitly issued', () => {
      const apiKey = new ApiKey();
      apiKey.scopes = [ApiKeyScope.UPLOAD];

      expect(apiKeyService.keyHasScope(apiKey, ApiKeyScope.UPLOAD)).toBe(true);
    });

    it('denies a scope the key was not issued', () => {
      const apiKey = new ApiKey();
      apiKey.scopes = [ApiKeyScope.READ_ONLY];

      expect(apiKeyService.keyHasScope(apiKey, ApiKeyScope.UPLOAD)).toBe(false);
    });

    it('the admin scope implies every other scope', () => {
      const apiKey = new ApiKey();
      apiKey.scopes = [ApiKeyScope.ADMIN];

      expect(apiKeyService.keyHasScope(apiKey, ApiKeyScope.UPLOAD)).toBe(true);
      expect(apiKeyService.keyHasScope(apiKey, ApiKeyScope.READ_ONLY)).toBe(true);
    });

    it('denies every scope when the key was issued with none (fails closed)', () => {
      const apiKey = new ApiKey();
      apiKey.scopes = [];

      expect(apiKeyService.keyHasScope(apiKey, ApiKeyScope.READ_ONLY)).toBe(false);
    });
  });

  describe('keyHasPermission', () => {
    it('grants a permission the key lists when the owning role still holds it', () => {
      const apiKey = new ApiKey();
      apiKey.permissions = [Permission.CONTENT_MODERATE];

      const user = new User();
      user.role = UserRole.MODERATOR;

      expect(apiKeyService.keyHasPermission(apiKey, user, Permission.CONTENT_MODERATE)).toBe(true);
    });

    it('denies a permission the key was not issued', () => {
      const apiKey = new ApiKey();
      apiKey.permissions = [];

      const user = new User();
      user.role = UserRole.ADMIN;

      expect(apiKeyService.keyHasPermission(apiKey, user, Permission.CONTENT_MODERATE)).toBe(false);
    });

    it('denies a permission the key lists once the owner is downgraded below it', () => {
      // Key was issued while the user was a moderator; the user has since
      // been demoted to a listener. The key must not keep the permission.
      const apiKey = new ApiKey();
      apiKey.permissions = [Permission.CONTENT_MODERATE];

      const user = new User();
      user.role = UserRole.LISTENER;

      expect(apiKeyService.keyHasPermission(apiKey, user, Permission.CONTENT_MODERATE)).toBe(false);
    });
  });
});
