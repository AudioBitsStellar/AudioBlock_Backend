import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// ── db mock ────────────────────────────────────────────────────────────────────
const mockQuery = jest.fn();

jest.mock('../database', () => ({
  getDBInstance: () => ({ query: mockQuery }),
}));

jest.mock('../config/logger', () => ({
  default: { warn: jest.fn(), debug: jest.fn() },
}));

import { RefreshTokenService } from '../services/RefreshTokenService';

// ── helpers ────────────────────────────────────────────────────────────────────
function makeService() {
  return new RefreshTokenService();
}

function storedRow(token: string, rotation: number) {
  return [{ token, rotation }];
}

// ── tests ──────────────────────────────────────────────────────────────────────
describe('RefreshTokenService', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('createRefreshToken', () => {
    it('returns a token and a family string', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const svc = makeService();
      const result = await svc.createRefreshToken('user-1');

      expect(result.token).toBeTruthy();
      expect(result.family).toBeTruthy();
      expect(typeof result.token).toBe('string');
      expect(typeof result.family).toBe('string');
    });

    it('stores the token with rotation=0', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const svc = makeService();
      await svc.createRefreshToken('user-1');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/INSERT INTO refresh_tokens/i);
      expect(params[0]).toBe('user-1');
      expect(params[3]).toBe(0); // rotation
    });
  });

  describe('rotateRefreshToken — happy path', () => {
    it('returns a new token on valid rotation', async () => {
      const currentToken = 'abc';
      mockQuery.mockResolvedValueOnce(storedRow(currentToken, 0)); // getRefreshToken
      mockQuery.mockResolvedValueOnce([]); // storeRefreshToken

      const svc = makeService();
      const result = await svc.rotateRefreshToken('user-1', currentToken, 'family-1');

      expect(result).not.toBeNull();
      expect(result!.newToken).toBeTruthy();
      expect(result!.newToken).not.toBe(currentToken);
    });

    it('stores the new token with rotation incremented by 1', async () => {
      const currentToken = 'tok';
      mockQuery.mockResolvedValueOnce(storedRow(currentToken, 3));
      mockQuery.mockResolvedValueOnce([]);

      const svc = makeService();
      await svc.rotateRefreshToken('user-1', currentToken, 'family-1');

      // second call is storeRefreshToken
      const [sql, params] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(sql).toMatch(/INSERT INTO refresh_tokens/i);
      expect(params[3]).toBe(4); // rotation was 3, now 4
    });
  });

  describe('rotateRefreshToken — reuse detection', () => {
    it('returns null and revokes family when token is not found', async () => {
      mockQuery.mockResolvedValueOnce([]); // getRefreshToken → not found
      mockQuery.mockResolvedValueOnce([]); // revokeRefreshToken

      const svc = makeService();
      const result = await svc.rotateRefreshToken('user-1', 'tok', 'family-1');

      expect(result).toBeNull();
      // revoke must have been called
      const [sql, params] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(sql).toMatch(/DELETE FROM refresh_tokens/i);
      expect(params).toContain('family-1');
    });

    it('returns null and revokes family when token does not match (reuse attack)', async () => {
      mockQuery.mockResolvedValueOnce(storedRow('stored-token', 0));
      mockQuery.mockResolvedValueOnce([]);

      const svc = makeService();
      const result = await svc.rotateRefreshToken('user-1', 'different-token', 'family-1');

      expect(result).toBeNull();
      const [sql] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(sql).toMatch(/DELETE FROM refresh_tokens/i);
    });

    it('returns null and revokes family when max rotations are reached', async () => {
      // MAX_ROTATIONS is 100 (from the service source)
      mockQuery.mockResolvedValueOnce(storedRow('tok', 100));
      mockQuery.mockResolvedValueOnce([]);

      const svc = makeService();
      const result = await svc.rotateRefreshToken('user-1', 'tok', 'family-1');

      expect(result).toBeNull();
      const [sql] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(sql).toMatch(/DELETE FROM refresh_tokens/i);
    });
  });

  describe('revokeRefreshToken', () => {
    it('deletes the specified family', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const svc = makeService();
      await svc.revokeRefreshToken('user-1', 'family-1');

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/DELETE FROM refresh_tokens/i);
      expect(params).toContain('user-1');
      expect(params).toContain('family-1');
    });
  });

  describe('revokeAllUserTokens', () => {
    it('deletes all tokens for the user', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const svc = makeService();
      await svc.revokeAllUserTokens('user-1');

      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/DELETE FROM refresh_tokens WHERE user_id/i);
      expect(params).toContain('user-1');
      // family must NOT be in the params — this is a full wipe
      expect(params.length).toBe(1);
    });
  });
});
