import { WalletController } from '../WalletController';

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

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

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
      const req: any = {};
      const res = mockRes();

      await controller.createEvmWallet(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, wallet }));
    });

    it('surfaces a service failure as an error response', async () => {
      mockCreateWallet.mockRejectedValue(new Error('Dynamic: Wallet creation failed'));
      const req: any = {};
      const res = mockRes();

      await controller.createEvmWallet(req, res);

      expect(res.status).not.toHaveBeenCalledWith(201);
    });
  });

  describe('signMessage', () => {
    it('returns 200 with the signature', async () => {
      mockSignMessage.mockResolvedValue('0xsig');
      const req: any = { body: { email: 'a@b.com', walletAddress: '0xabc', message: 'Nonce: 1' } };
      const res = mockRes();

      await controller.signMessage(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, signature: '0xsig' }),
      );
    });

    it('surfaces a service failure as an error response', async () => {
      mockSignMessage.mockRejectedValue(new Error('Dynamic: Error signing message'));
      const req: any = { body: {} };
      const res = mockRes();

      await controller.signMessage(req, res);

      expect(res.status).not.toHaveBeenCalledWith(200);
    });
  });
});
