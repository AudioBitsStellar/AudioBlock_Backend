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

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return handleError(req, res, AppError.authentication('Privy token required'));
    }

    const token = authHeader.split(' ')[1];

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

function decodePrivyToken(token: string, verificationKey: string): PrivyUser | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

    return {
      id: payload.sub || payload.id,
      email: payload.email,
      walletAddress: payload.walletAddress,
    };
  } catch (error) {
    console.error('Failed to decode Privy token:', error);
    return null;
  }
}
