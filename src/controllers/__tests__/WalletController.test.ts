import { WalletController } from '../WalletController';
import {
  createMockRequest,
  createMockResponse,
  assertSuccessResponse,
  assertErrorResponse,
} from '../../../tests/helpers';

// Factory mock (not a bare auto-mock): WalletService transitively imports
// @dynamic-labs-wallet/core, which ships ESM-only deps ts-jest can't parse.
// A factory avoids ever loading the real module. Named mock fns (prefixed
// "mock") are referenced directly rather than via `WalletService.mock
// .instances`, since `new WalletService()` here returns an object-literal
// override — the constructor's `this` (what `.mock.instances` records) is
// discarded per JS `new` semantics, not the object the controller actually
// receives.
const mockCreateWallet = jest.fn();
const mockSignMessage = jest.fn();
jest.mock('../../services/Dynamic/WalletService', () => ({
  WalletService: jest.fn().mockImplementation(() => ({
    createWallet: mockCreateWallet,
    signMessage: mockSignMessage,
  })),
}));

describe('WalletController', () => {
  let controller: WalletController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new WalletController();
  });

  describe('createEvmWallet', () => {
    it('returns 201 with the created wallet', async () => {
      const wallet = { accountAddress: '0xabc' };
      mockCreateWallet.mockResolvedValue(wallet);
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.createEvmWallet(req, res as any);

      assertSuccessResponse(res, { status: 201, data: { wallet } });
    });

    it('surfaces a service failure as an error response', async () => {
      mockCreateWallet.mockRejectedValue(new Error('Dynamic: Wallet creation failed'));
      const req = createMockRequest();
      const res = createMockResponse();

      await controller.createEvmWallet(req, res as any);

      assertErrorResponse(res, { status: 400, message: 'Dynamic: Wallet creation failed' });
    });
  });

  describe('signMessage', () => {
    it('returns 200 with the signature', async () => {
      mockSignMessage.mockResolvedValue('0xsig');
      const req = createMockRequest({
        body: { email: 'a@b.com', walletAddress: '0xabc', message: 'Nonce: 1' },
      });
      const res = createMockResponse();

      await controller.signMessage(req, res as any);

      assertSuccessResponse(res, { status: 200, data: { signature: '0xsig' } });
    });

    it('surfaces a service failure as an error response', async () => {
      mockSignMessage.mockRejectedValue(new Error('Dynamic: Error signing message'));
      const req = createMockRequest({ body: {} });
      const res = createMockResponse();

      await controller.signMessage(req, res as any);

      assertErrorResponse(res, { status: 400, message: 'Dynamic: Error signing message' });
    });
  });
});
