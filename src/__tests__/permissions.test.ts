import {
  Permission,
  ROLE_PERMISSIONS,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
} from '../types/permissions';
import { UserRole } from '../entities/User';

describe('Permission System', () => {
  describe('ROLE_PERMISSIONS', () => {
    it('should have permissions defined for all roles', () => {
      expect(ROLE_PERMISSIONS[UserRole.LISTENER]).toBeDefined();
      expect(ROLE_PERMISSIONS[UserRole.ARTIST]).toBeDefined();
      expect(ROLE_PERMISSIONS[UserRole.MODERATOR]).toBeDefined();
      expect(ROLE_PERMISSIONS[UserRole.ADMIN]).toBeDefined();
      expect(ROLE_PERMISSIONS[UserRole.SUPER_ADMIN]).toBeDefined();
    });

    it('LISTENER should have minimal permissions', () => {
      const permissions = ROLE_PERMISSIONS[UserRole.LISTENER];
      expect(permissions).toContain(Permission.UPDATE_OWN_PROFILE);
      expect(permissions).not.toContain(Permission.UPLOAD_SONG);
      expect(permissions).not.toContain(Permission.DELETE_USER);
    });

    it('ARTIST should have song upload permissions', () => {
      const permissions = ROLE_PERMISSIONS[UserRole.ARTIST];
      expect(permissions).toContain(Permission.UPLOAD_SONG);
      expect(permissions).toContain(Permission.DELETE_OWN_SONG);
      expect(permissions).not.toContain(Permission.DELETE_ANY_SONG);
      expect(permissions).not.toContain(Permission.ASSIGN_ROLE);
    });

    it('MODERATOR should have moderation permissions', () => {
      const permissions = ROLE_PERMISSIONS[UserRole.MODERATOR];
      expect(permissions).toContain(Permission.FLAG_SONG);
      expect(permissions).toContain(Permission.MODERATE_SONG);
      expect(permissions).toContain(Permission.MODERATE_COMMENTS);
      expect(permissions).not.toContain(Permission.DELETE_USER);
      expect(permissions).not.toContain(Permission.ASSIGN_ROLE);
    });

    it('ADMIN should have most permissions except role assignment', () => {
      const permissions = ROLE_PERMISSIONS[UserRole.ADMIN];
      expect(permissions).toContain(Permission.DELETE_USER);
      expect(permissions).toContain(Permission.DELETE_ANY_SONG);
      expect(permissions).toContain(Permission.MANAGE_JOBS);
      expect(permissions).not.toContain(Permission.ASSIGN_ROLE);
    });

    it('SUPER_ADMIN should have all permissions including role assignment', () => {
      const permissions = ROLE_PERMISSIONS[UserRole.SUPER_ADMIN];
      expect(permissions).toContain(Permission.ASSIGN_ROLE);
      expect(permissions).toContain(Permission.DELETE_USER);
      expect(permissions).toContain(Permission.MANAGE_JOBS);
      expect(permissions).toContain(Permission.UPLOAD_SONG);
    });
  });

  describe('hasPermission', () => {
    it('should return true when role has the permission', () => {
      expect(hasPermission(UserRole.ARTIST, Permission.UPLOAD_SONG)).toBe(true);
      expect(hasPermission(UserRole.MODERATOR, Permission.FLAG_SONG)).toBe(true);
      expect(hasPermission(UserRole.SUPER_ADMIN, Permission.ASSIGN_ROLE)).toBe(true);
    });

    it('should return false when role does not have the permission', () => {
      expect(hasPermission(UserRole.LISTENER, Permission.UPLOAD_SONG)).toBe(false);
      expect(hasPermission(UserRole.ARTIST, Permission.DELETE_USER)).toBe(false);
      expect(hasPermission(UserRole.ADMIN, Permission.ASSIGN_ROLE)).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    it('should return true when role has all specified permissions', () => {
      expect(
        hasAllPermissions(UserRole.ARTIST, [Permission.UPLOAD_SONG, Permission.DELETE_OWN_SONG]),
      ).toBe(true);

      expect(
        hasAllPermissions(UserRole.MODERATOR, [Permission.FLAG_SONG, Permission.MODERATE_SONG]),
      ).toBe(true);
    });

    it('should return false when role is missing any permission', () => {
      expect(
        hasAllPermissions(UserRole.ARTIST, [Permission.UPLOAD_SONG, Permission.DELETE_USER]),
      ).toBe(false);

      expect(
        hasAllPermissions(UserRole.MODERATOR, [Permission.FLAG_SONG, Permission.ASSIGN_ROLE]),
      ).toBe(false);
    });

    it('should return true for empty permission array', () => {
      expect(hasAllPermissions(UserRole.LISTENER, [])).toBe(true);
    });
  });

  describe('hasAnyPermission', () => {
    it('should return true when role has at least one permission', () => {
      expect(
        hasAnyPermission(UserRole.ARTIST, [Permission.UPLOAD_SONG, Permission.DELETE_USER]),
      ).toBe(true);

      expect(
        hasAnyPermission(UserRole.MODERATOR, [Permission.FLAG_SONG, Permission.ASSIGN_ROLE]),
      ).toBe(true);
    });

    it('should return false when role has none of the permissions', () => {
      expect(
        hasAnyPermission(UserRole.LISTENER, [Permission.DELETE_USER, Permission.ASSIGN_ROLE]),
      ).toBe(false);

      expect(
        hasAnyPermission(UserRole.ARTIST, [Permission.DELETE_USER, Permission.ASSIGN_ROLE]),
      ).toBe(false);
    });

    it('should return false for empty permission array', () => {
      expect(hasAnyPermission(UserRole.ADMIN, [])).toBe(false);
    });
  });

  describe('Permission boundaries', () => {
    it('should ensure LISTENER cannot perform admin actions', () => {
      expect(hasPermission(UserRole.LISTENER, Permission.DELETE_USER)).toBe(false);
      expect(hasPermission(UserRole.LISTENER, Permission.MANAGE_JOBS)).toBe(false);
      expect(hasPermission(UserRole.LISTENER, Permission.ASSIGN_ROLE)).toBe(false);
    });

    it('should ensure only SUPER_ADMIN can assign roles', () => {
      expect(hasPermission(UserRole.LISTENER, Permission.ASSIGN_ROLE)).toBe(false);
      expect(hasPermission(UserRole.ARTIST, Permission.ASSIGN_ROLE)).toBe(false);
      expect(hasPermission(UserRole.MODERATOR, Permission.ASSIGN_ROLE)).toBe(false);
      expect(hasPermission(UserRole.ADMIN, Permission.ASSIGN_ROLE)).toBe(false);
      expect(hasPermission(UserRole.SUPER_ADMIN, Permission.ASSIGN_ROLE)).toBe(true);
    });
  });
});
