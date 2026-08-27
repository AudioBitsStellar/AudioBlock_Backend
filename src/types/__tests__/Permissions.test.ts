import { UserRole } from '../../entities/User';
import { Permission, ROLE_PERMISSIONS, roleHasPermission } from '../Permissions';

describe('RBAC permission map (#100)', () => {
  it('defines a permission list for every role', () => {
    for (const role of Object.values(UserRole)) {
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });

  it('grants no elevated permissions to listeners or artists', () => {
    expect(ROLE_PERMISSIONS[UserRole.LISTENER]).toEqual([]);
    expect(ROLE_PERMISSIONS[UserRole.ARTIST]).toEqual([]);
  });

  it('lets moderators moderate content but not manage users or roles', () => {
    expect(roleHasPermission(UserRole.MODERATOR, Permission.CONTENT_MODERATE)).toBe(true);
    expect(roleHasPermission(UserRole.MODERATOR, Permission.USER_MANAGE)).toBe(false);
    expect(roleHasPermission(UserRole.MODERATOR, Permission.ROLE_ASSIGN)).toBe(false);
  });

  it('lets admins assign roles and manage users', () => {
    expect(roleHasPermission(UserRole.ADMIN, Permission.ROLE_ASSIGN)).toBe(true);
    expect(roleHasPermission(UserRole.ADMIN, Permission.USER_MANAGE)).toBe(true);
  });

  it('grants super_admin every defined permission', () => {
    for (const permission of Object.values(Permission)) {
      expect(roleHasPermission(UserRole.SUPER_ADMIN, permission)).toBe(true);
    }
  });

  it('returns false for a role that is not in the map', () => {
    expect(roleHasPermission('ghost' as UserRole, Permission.CONTENT_MODERATE)).toBe(false);
  });
});
