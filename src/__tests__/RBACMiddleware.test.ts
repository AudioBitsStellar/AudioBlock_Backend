import { Request, Response, NextFunction } from 'express';
import {
  requireRoles,
  requirePermissions,
  hasPermission,
  hasRole,
  requireArtist,
  requireAdmin,
  canAccessResource,
} from '../middlewares/rbacMiddleware';
import { UserRole } from '../entities/User';
import { AppError } from '../errors/AppError';

describe('RBAC Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNe
 'create:song')).toBe(true);
    });

    it('should return false for listener with create:song permission', () => {
      expect(hasPermission(UserRole.LISTENER, 'create:song')).toBe(false);
    });

    it('should return true for moderator with moderate:content permission', () => {
      expect(hasPermission(UserRole.MODERATOR, 'moderate:content')).toBe(true);
    });

    it('should return false for artist with moderate:content permission', () => {
      expect(hasPermission(UserRole.ARTIST, 'moderate:con
 () => {
      (mockReq as any).user = { id: 'user-123', role: UserRole.ARTIST };

      const middleware = requireRoles([UserRole.ARTIST, UserRole.ADMIN]);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject user without allowed role', () => {
      (mockReq as any).user = { id: 'user-123', role: UserRole.LISTENER };

      const middleware = requireRoles([UserRole.ARTIST, UserRole.ADMIN]);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject unauthenticated request', () => {
      const middleware = requireRoles([UserRole.ARTIST]);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should work with privyUser property', () => {
      (mockReq as any).privyUser = { id: 'user-123', role: UserRole.ARTIST };

      const middleware = requireRoles([UserRole.ARTIST]);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('requirePermissions middleware', () => {
    it('should call next() for user with required permissions', () => {
      (mockReq as any).user = { id: 'user-123', role: UserRole.ARTIST };

      const middleware = requirePermissions(['create:song', 'read:own_song']);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject user without required permissions', () => {
      (mockReq as any).user = { id: 'user-123', role: UserRole.LISTENER };

      const middleware = requirePermissions(['create:song']);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject unauthenticated request', () => {
      const middleware = requirePermissions(['create:song']);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should allow super admin with any permission', () => {
      (mockReq as any).user = { id: 'user-123', role: UserRole.SUPER_ADMIN };

      const middleware = requirePermissions(['any:permission']);
      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('requireArtist middleware', () => {
    it('should allow artist role', () => {
      (mockReq as any).user = { id: 'user-123', role: UserRole.ARTIST };

      requireArtist(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow admin role', () => {
      (mockReq as any).user = { id: 'user-123', role: UserRole.ADMIN };

      requireArtist(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject listener role', () => {
      (mockReq as any).user = { id: 'user-123', role: UserRole.LISTENER };

      requireArtist(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('requireAdmin middleware', () => {
    it('should allow admin role', () => {
      (mockReq as any).user = { id: 'user-123', role: UserRole.ADMIN };

      requireAdmin(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should allow super admin role', () => {
      (moc
esource owner', () => {
      const user = { id: 'user-123', role: UserRole.LISTENER };
      const resourceOwnerId = 'user-123';

      expect(canAccessResource(user, resourceOwnerId)).toBe(true);
    });

    it('should return true for admin accessing any resource', () => {
      const user = { id: 'admin-123', role: UserRole.ADMIN };
      const resourceOwnerId = 'user-456';

      expect(canAccessResource(user, resourceOwnerId)).toBe(true);
    });

    it('should return false for non-owner without admin privileges', () => {
      const user = { id: 'user-123', role: UserRole.LISTENER };
      const resourceOwnerId = 'user-456';

      expect(canAccessResource(user, resourceOwnerId)).toBe(false);
    });

    it('should return true for super admin accessing any resource', () => {
      const user = { id: 'superadmin-123', role: UserRole.SUPER_ADMIN };
      const resourceOwnerId = 'user-456';

      expect(canAccessResource(user, resourceOwnerId)).toBe(true);
    });
  });
});

