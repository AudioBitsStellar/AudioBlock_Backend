const mockPrepare = jest.fn();
const mockSubmit = jest.fn();
jest.mock('../../services/Artist/ArtistService', () => ({
  ArtistService: jest.fn().mockImplementation(() => ({
    prepareArtistOnChainSetup: mockPrepare,
    submitArtistOnChainSetup: mockSubmit,
  })),
}));

import { ArtistOnChainController } from '../ArtistOnChainController';
import { AppError } from '../../errors/AppError';
import { createMockRequest, createMockResponse } from '../../../tests/helpers';

describe('ArtistOnChainController', () => {
  let controller: ArtistOnChainController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ArtistOnChainController();
  });

  it('prepares with xdr and network passphrase', async () => {
    mockPrepare.mockResolvedValue({
      xdr: 'AAAA',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    const req = createMockRequest({ user: { id: 'u1' }, body: { cid: 'cid1' } });
    const res = createMockResponse();

    await controller.prepareSetup(req, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns the wallet validation error as 400', async () => {
    mockPrepare.mockRejectedValue(
      AppError.validation('Connect a Stellar wallet before setting up an on-chain artist profile'),
    );
    const req = createMockRequest({ user: { id: 'u1' }, body: { cid: 'cid1' } });
    const res = createMockResponse();

    await controller.prepareSetup(req, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns submit success exactly once', async () => {
    mockSubmit.mockResolvedValue({ txHash: 'h1', artistId: '5', tokenId: '9' });
    const req = createMockRequest({ user: { id: 'u1' }, body: { signedXdr: 'AAAA' } });
    const res = createMockResponse();

    await controller.submitSetup(req, res as any);

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns source-account mismatch as 403', async () => {
    mockSubmit.mockRejectedValue(
      AppError.authorization(
        'Signed transaction source account does not match the connected Stellar wallet',
      ),
    );
    const req = createMockRequest({ user: { id: 'u1' }, body: { signedXdr: 'AAAA' } });
    const res = createMockResponse();

    await controller.submitSetup(req, res as any);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
