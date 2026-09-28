import crypto from 'crypto';
import { DataSource } from 'typeorm';
import { getDBInstance } from '../database';
import logger from '../config/logger';

export interface RefreshTokenPayload {
  userId: string;
  tokenFamily: string;
  rotation: number;
}

const REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000;
const MAX_ROTATIONS = 100;

export class RefreshTokenService {
  private db: DataSource;

  constructor() {
    this.db = getDBInstance();
  }

  async createRefreshToken(userId: string): Promise<{ token: string; family: string }> {
    const family = crypto.randomBytes(16).toString('hex');
    const token = this.generateToken();

    await this.storeRefreshToken(userId, token, family, 0);

    return { token, family };
  }

  async rotateRefreshToken(
    userId: string,
    currentToken: string,
    tokenFamily: string,
  ): Promise<{ newToken: string; newFamily?: string } | null> {
    const stored = await this.getRefreshToken(userId, tokenFamily);

    if (!stored) {
      logger.warn(
        { userId, tokenFamily },
        'Refresh token not found - possible token reuse attack',
      );
      await this.revokeTokenFamily(userId, tokenFamily);
      return null;
    }

    if (stored.token !== currentToken) {
      logger.warn(
        { userId, tokenFamily },
        'Token mismatch in rotation - possible token reuse attack',
      );
      await this.revokeTokenFamily(userId, tokenFamily);
      return null;
    }

    if (stored.rotation >= MAX_ROTATIONS) {
      logger.warn({ userId, tokenFamily }, 'Max token rotations reached');
      await this.revokeTokenFamily(userId, tokenFamily);
      return null;
    }

    const newToken = this.generateToken();
    await this.storeRefreshToken(userId, newToken, tokenFamily, stored.rotation + 1);

    return { newToken };
  }

  async revokeRefreshToken(userId: string, tokenFamily: string): Promise<void> {
    await this.db.query('DELETE FROM refresh_tokens WHERE user_id = $1 AND family = $2', [
      userId,
      tokenFamily,
    ]);

    logger.debug({ userId, tokenFamily }, 'Refresh token revoked');
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);

    logger.debug({ userId }, 'All user refresh tokens revoked');
  }

  private async getRefreshToken(
    userId: string,
    family: string,
  ): Promise<{ token: string; rotation: number } | null> {
    const result = await this.db.query(
      'SELECT token, rotation FROM refresh_tokens WHERE user_id = $1 AND family = $2 AND expires_at > NOW()',
      [userId, family],
    );

    return result.length > 0 ? result[0] : null;
  }

  private async storeRefreshToken(
    userId: string,
    token: string,
    family: string,
    rotation: number,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY);

    await this.db.query(
      `INSERT INTO refresh_tokens (user_id, family, token, rotation, created_at, expires_at)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       ON CONFLICT (user_id, family) DO UPDATE SET
         token = $3,
         rotation = $4,
         created_at = NOW(),
         expires_at = $5`,
      [userId, family, token, rotation, expiresAt],
    );
  }

  private async revokeTokenFamily(userId: string, family: string): Promise<void> {
    await this.revokeRefreshToken(userId, family);
  }

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}
