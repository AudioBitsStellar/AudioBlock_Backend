import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { handleError } from '../utils/helpers';
import { privyConfig, isPrivyEnabled } from '../config/privy';

export interface PrivyUser {
  id: string;
  email?: string;
  walletAddress?: string;
}

declare global {
  namespace Express {
    interface Request {
      privyUser?: PrivyUser;
    }
  }
}

export const requirePrivyAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!isPrivyEnabled) {
    return handleError(req, res, AppError.authentication('Privy authentication is not enabled'));
  }

  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return handleError(req, res, AppError.authentication('Privy token required'));
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      return handleError(req, res, AppError.authentication('Invalid Privy token'));
    }

    if (!privyConfig.verificationKey) {
      console.error('Privy verification key not configured');
      return handleError(req, res, AppError.authentication('Privy configuration error'));
    }

    const decodedUser = decodePrivyToken(token, privyConfig.verificationKey);
    if (!decodedUser) {
      return handleError(req, res, AppError.authentication('Invalid Privy token'));
    }

    req.privyUser = decodedUser;
    next();
  } catch (error) {
    console.error('Privy auth middleware error:', error);
    return handleError(req, res, AppError.authentication('Privy authentication failed'));
  }
};

export function decodePrivyToken(token: string, verificationKey?: string): PrivyUser | null {
  try {
    if (!token || typeof token !== 'string') {
      return null;
    }

    const trimmedToken = token.trim();
    const parts = trimmedToken.split('.');
    if (parts.length !== 3) {
      return null;
    }

    let headerStr: string;
    let payloadStr: string;
    try {
      headerStr = Buffer.from(parts[0], 'base64').toString('utf-8');
      payloadStr = Buffer.from(parts[1], 'base64').toString('utf-8');
    } catch {
      return null;
    }

    if (!payloadStr || !headerStr) {
      return null;
    }

    let payload: any;
    try {
      payload = JSON.parse(payloadStr);
    } catch {
      return null;
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }

    const userId = payload.sub || payload.id;
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      return null;
    }

    // Check expiration if exp claim is present
    if (payload.exp !== undefined) {
      if (typeof payload.exp !== 'number' || isNaN(payload.exp)) {
        return null;
      }
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        return null;
      }
    }

    return {
      id: userId.trim(),
      email: typeof payload.email === 'string' && payload.email.trim() ? payload.email.trim() : undefined,
      walletAddress: typeof payload.walletAddress === 'string' && payload.walletAddress.trim() ? payload.walletAddress.trim() : undefined,
    };
  } catch (error) {
    console.error('Failed to decode Privy token:', error);
    return null;
  }
}
