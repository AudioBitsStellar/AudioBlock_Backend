import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

interface JwtPayload {
  id: string; // or userId, depending on how you signed it
  role?: string;
  email?: string;
  walletAddress?: string;
  username?: string;
  name?: string;
}

export const authArtistMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // 1️⃣ Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No token provided",
      });
    }

    const token = authHeader.split(" ")[1];

    // 2 Verify token
    const secret = process.env.JWT_SECRET!;
    const decoded = jwt.verify(token, secret) as JwtPayload;

    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Invalid token",
      });
    }

    if (decoded.role !== "artist") {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Artist role required",
      });
    }

    // 3️ Attach user to request
    (req as any).user = decoded;

    next(); // 4 move to next route handler
  } catch (error) {
    console.error("JWT verification error:", error);
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Invalid or expired token",
    });
  }
};


export const authListenerMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // 1️⃣ Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No token provided",
      });
    }

    const token = authHeader.split(" ")[1];

    // 2 Verify token
    const secret = process.env.JWT_SECRET!;
    const decoded = jwt.verify(token, secret) as JwtPayload;

    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Invalid token",
      });
    }

    if (decoded.role !== "listener") {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Listener role required",
      });
    }

    // 3️ Attach user to request
    (req as any).user = decoded;

    next(); // 4 move to next route handler
  } catch (error) {
    console.error("JWT verification error:", error);
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Invalid or expired token",
    });
  }
};