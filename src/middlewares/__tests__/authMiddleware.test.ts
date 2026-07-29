import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import {
  requireAuth,
  requireRoles,
  requirePermission,
  requireAllPermissions,
  requireAnyPermission,
  JwtPayload,
} from '../authMiddleware';
import { UserRole } from '../../entities/User';
import { Permission } from '../../types/permissions';
import { AppError } from '../../errors/AppError';

jest.mock('jsonwebtoken');

describe('Auth Middleware - RBAC', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      headers: {},
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    nextFunction = jest.fn();

    process.env.JWT_SECRET = 'test-secret';
  });

  describe('requireAuth', () => {
    it('should authenticate valid token and set req.user', () => {
      const mockPayload: JwtPayload = {
        id: 'user-123',
        role: UserRole.ARTIST,
        email: 'test@example.com',
      };

      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

      requireAuth(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(jwt.verify).toHaveBeenCalledWith('valid-token', 'test-secret');
      expect((mockRequest as any).user).toEqual(mockPayload);
      expect(nextFunction).toHaveBeenCalled();
    });

    it('should reject request without authorization header', () => {
      requireAuth(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should reject malformed authorization header', () => {
      mockRequest.headers = {
        authorization: 'InvalidFormat',
      };

      requireAuth(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should reject invalid token', () => {
      mockRequest.headers = {
        authorization: 'Bearer invalid-token',
      };

      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      requireAuth(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });

  describe('requireRoles', () => {
    it('should allow request when user has required role', () => {
      const mockPayload: JwtPayload = {
        id: 'user-123',
        role: UserRole.ADMIN,
      };

      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

      const middleware = requireRoles(UserRole.ADMIN);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should allow request when user has one of multiple required roles', () => {
      const mockPayload: JwtPayload = {
        id: 'user-123',
        role: UserRole.MODERATOR,
      };

      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

      const middleware = requireRoles(UserRole.ADMIN, UserRole.MODERATOR);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should reject request when user does not have required role (returns 403)', () => {
      const mockPayload: JwtPayload = {
        id: 'user-123',
        role: UserRole.LISTENER,
      };

      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

      const middleware = requireRoles(UserRole.ADMIN);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should reject request when user role is undefined', () => {
      const mockPayload: JwtPayload = {
        id: 'user-123',
      };

      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

      const middleware = requireRoles(UserRole.ADMIN);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });

  describe('requirePermission', () => {
    it('should allow request when user role has required permission', () => {
      const mockPayload: JwtPayload = {
        id: 'user-123',
        role: UserRole.ARTIST,
      };

      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

      const middleware = requirePermission(Permission.UPLOAD_SONG);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should reject request when user role lacks required permission (returns 403)', () => {
      const mockPayload: JwtPayload = {
        id: 'user-123',
        role: UserRole.LISTENER,
      };

      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

      const middleware = requirePermission(Permission.UPLOAD_SONG);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should allow SUPER_ADMIN to assign roles', () => {
      const mockPayload: JwtPayload = {
        id: 'user-123',
        role: UserRole.SUPER_ADMIN,
      };

      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

      const middleware = requirePermission(Permission.ASSIGN_ROLE);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should reject ADMIN from assigning roles', () => {
      const mockPayload: JwtPayload = {
        id: 'user-123',
        role: UserRole.ADMIN,
      };

      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

      const middleware = requirePermission(Permission.ASSIGN_ROLE);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });

  describe('requireAllPermissions', () => {
    it('should allow request when user has all required permissions', () => {
      const mockPayload: JwtPayload = {
        id: 'user-123',
        role: UserRole.ARTIST,
      };

      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

      const middleware = requireAllPermissions(Permission.UPLOAD_SONG, Permission.DELETE_OWN_SONG);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should reject request when user lacks one of the required permissions', () => {
      const mockPayload: JwtPayload = {
        id: 'user-123',
        role: UserRole.ARTIST,
      };

      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

      const middleware = requireAllPermissions(Permission.UPLOAD_SONG, Permission.DELETE_USER);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });

  describe('requireAnyPermission', () => {
    it('should allow request when user has at least one required permission', () => {
      const mockPayload: JwtPayload = {
        id: 'user-123',
        role: UserRole.ARTIST,
      };

      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

      const middleware = requireAnyPermission(Permission.UPLOAD_SONG, Permission.DELETE_USER);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should reject request when user has none of the required permissions', () => {
      const mockPayload: JwtPayload = {
        id: 'user-123',
        role: UserRole.LISTENER,
      };

      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

      const middleware = requireAnyPermission(Permission.DELETE_USER, Permission.ASSIGN_ROLE);
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });

  describe('Role hierarchy validation', () => {
    it('should allow MODERATOR to flag songs but not delete users', () => {
      const mockPayload: JwtPayload = {
        id: 'user-123',
        role: UserRole.MODERATOR,
      };

      mockRequest.headers = {
        authorization: 'Bearer valid-token',
      };

      (jwt.verify as jest.Mock).mockReturnValue(mockPayload);

      // Should allow flagging
      const flagMiddleware = requirePermission(Permission.FLAG_SONG);
      flagMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(nextFunction).toHaveBeenCalledTimes(1);

      // Should reject deleting users
      nextFunction = jest.fn();
      const deleteMiddleware = requirePermission(Permission.DELETE_USER);
      deleteMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });
});
