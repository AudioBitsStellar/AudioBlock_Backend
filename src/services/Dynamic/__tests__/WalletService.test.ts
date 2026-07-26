import { WalletService } from '../WalletService';
import { createEvmWallet, authenticatedEvmClient } from '../../../utils/dynamicUtils';
import redis from '../../../config/redis';

// dynamicUtils (and @dynamic-labs-wallet/core, which it re-exports from)
// pulls in ESM-only transitive deps (@noble/hashes, viem) that ts-jest can't
// parse. Factory mocks for both avoid ever loading the real modules — a bare
// `jest.mock(path)` auto-mock still requires jest to load the real file
// first to infer its shape, which hits the same parse error.
jest.mock('@dynamic-labs-wallet/core', () => ({
  ThresholdSignatureScheme: { TWO_OF_TWO: 'TWO_OF_TWO' },
}));
jest.mock('../../../utils/dynamicUtils', () => ({
  createEvmWallet: jest.fn(),
  authenticatedEvmClient: jest.fn(),
}));
jest.mock('../../../config/redis', () => ({
  get: jest.fn(),
}));

const mockedCreateEvmWallet = createEvmWallet as jest.Mock;
const mockedAuthenticatedEvmClient = authenticatedEvmClient as jest.Mock;
const mockedRedisGet = redis.get as jest.Mock;

describe('WalletService', () => {
  let service: WalletService;

  beforeEach(() => {
    service = new WalletService();
    jest.clearAllMocks();
  });

  describe('createWallet', () => {
    it('returns the created wallet on success', async () => {
      const wallet = { accountAddress: '0xabc123' };
      mockedCreateEvmWallet.mockResolvedValue(wallet);

      const result = await service.createWallet();

      expect(result).toEqual(wallet);
      expect(mockedCreateEvmWallet).toHaveBeenCalledTimes(1);
    });

    it('maps an insufficient-funds error to a clear message', async () => {
      mockedCreateEvmWallet.mockRejectedValue(new Error('insufficient funds for gas'));

      await expect(service.createWallet()).rejects.toThrow(
        'Dynamic: Insufficient funds for wallet creation',
      );
    });

    it('maps an invalid-session error to a clear message', async () => {
      mockedCreateEvmWallet.mockRejectedValue(new Error('invalid session'));

      await expect(service.createWallet()).rejects.toThrow(
        'Dynamic: Invalid session ID - please re-authenticate',
      );
    });

    it('falls back to a generic message for unknown errors', async () => {
      mockedCreateEvmWallet.mockRejectedValue(new Error('boom'));

      await expect(service.createWallet()).rejects.toThrow('Dynamic: Wallet creation failed');
    });
  });

  describe('signMessage', () => {
    const basePayload = {
      email: 'artist@example.com',
      walletAddress: '0xabc123',
      message: 'Sign in — Nonce: abc123',
    };

    it('rejects when the message has no nonce', async () => {
      await expect(
        service.signMessage({ ...basePayload, message: 'no nonce here' } as any),
      ).rejects.toThrow('Dynamic: Error signing message');
    });

    it('rejects when the stored nonce does not match', async () => {
      mockedRedisGet.mockResolvedValue('different-nonce');

      await expect(service.signMessage(basePayload as any)).rejects.toThrow(
        'Dynamic: Error signing message',
      );
    });

    it('signs the message once the nonce matches', async () => {
      mockedRedisGet.mockResolvedValue('abc123');
      const signature = '0xsignature';
      mockedAuthenticatedEvmClient.mockResolvedValue({
        exportExternalServerKeyShares: jest.fn().mockResolvedValue({ shares: [] }),
        signMessage: jest.fn().mockResolvedValue(signature),
      });

      const result = await service.signMessage(basePayload as any);

      expect(result).toBe(signature);
      expect(mockedRedisGet).toHaveBeenCalledWith(`nonce:${basePayload.email}`);
    });
  });
});
