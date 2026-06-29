import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { UserRole } from "../entities/User";

export interface JwtPayload {
  id: string;
  role?: UserRole;
  email?: string;
  walletAddress?: string;
  stellarPublicKey?: string;
  username?: string;
  name?: string;
  emailVerified?: boolean;
}

export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No token provided",
      });
    }

    const token = authHeader.split(" ")[1];
    const secret = process.env.JWT_SECRET!;
    const decoded = jwt.verify(token, secret) as JwtPayload;

    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Invalid token",
      });
    }

    (req as any).user = decoded;
    next();
  } catch (error) {
    console.error("JWT verification error:", error);
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Invalid or expired token",
    });
  }
};

export const requireRoles = (...allowedRoles: UserRole[]) => (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  return requireAuth(req, res, () => {
    const role = (req as any).user?.role as UserRole | undefined;
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: one of these roles is required: ${allowedRoles.join(", ")}`,
      });
    }

    return next();
  });
};

export const authArtistMiddleware = requireRoles(UserRole.ARTIST, UserRole.ADMIN);
export const authListenerMiddleware = requireRoles(UserRole.LISTENER, UserRole.ADMIN);

export const requireEmailVerified = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: No user in session",
    });
  }

  if (user.emailVerified === false) {
    return res.status(403).json({
      success: false,
      message: "Email verification required for this action",
    });
  }

  next();
};

export const requireArtistAndVerified = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  return requireRoles(UserRole.ARTIST, UserRole.ADMIN)(req, res, () => {
    return requireEmailVerified(req, res, next);
  });
};
