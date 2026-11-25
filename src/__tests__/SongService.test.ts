import 'reflect-metadata';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock('../config/rabbitmq', () => ({
  getChannel: jest.fn().mockReturnValue({ sendToQueue: jest.fn() }),
}));
jest.mock('../config/s3', () => ({
  s3: {
    upload: jest
      .fn()
      .mockReturnValue({ promise: jest.fn().mockResolvedValue({ Location: 's3://bucket/key' }) }),
  },
}));
jest.mock('../services/Soroban/SorobanService', () => ({
  SorobanTransactionFailedError: class SorobanTransactionFailedError extends Error {},
  SorobanService: jest.fn().mockImplementation(() => ({
    prepareInvocation: jest.fn(),
    submitSignedTransaction: jest.fn(),
    getSignedTransactionHash: jest.fn().mockReturnValue('precomputed-hash'),
    getTransaction: jest.fn(),
  })),
  addressArg: jest.fn((v) => v),
  stringArg: jest.fn((v) => v),
  u64Arg: jest.fn((v) => v),
}));
jest.mock('../config/soroban', () => ({
  SorobanContracts: { catalog: 'CATALOG_CONTRACT' },
  getNetworkPassphrase: jest.fn().mockReturnValue('Test SDF Network ; September 2015'),
  getSorobanServer: jest.fn(),
  getSorobanRpcUrl: jest.fn(),
}));

import AppDataSource from '../config/db';
import { SorobanService } from '../services/Soroban/SorobanService';
import { SongService } from '../services/SongService';
import { Song } from '../entities/Song';
import { User } from '../entities/User';

const mockSongRepo = {
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
};
const mockUserRepo = {
  findOneBy: jest.fn(),
};

let mockSorobanInstance: {
  prepareInvocation: jest.Mock;
  submitSignedTransaction: jest.Mock;
  getSignedTransactionHash: jest.Mock;
  getTransaction: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: unknown) => {
    if (entity === Song) return mockSongRepo;
    if (entity === User) return mockUserRepo;
    return mockSongRepo;
  });
  mockSorobanInstance = (SorobanService as jest.Mock).mock.instances?.[0] ?? {
    prepareInvocation: jest.fn(),
    submitSignedTransaction: jest.fn(),
  };
});

// Helper to get the soroban instance from the service after instantiation
function makeSvc() {
  const svc = new SongService();
  // Access the private soroban instance via any
  mockSorobanInstance = (svc as any).soroban;
  return svc;
}

describe('SongService.prepareSongMintTx', () => {
  it('throws when song is not found', async () => {
    mockSongRepo.findOne.mockResolvedValue(null);
    const svc = makeSvc();
    await expect(svc.prepareSongMintTx('missing-id')).rejects.toMatchObject({
      statusCode: 404,
      code: 'SONG_NOT_FOUND',
    });
  });

  it('throws when song has no metadata CID', async () => {
    mockSongRepo.findOne.mockResolvedValue({
      id: 's1',
      metadataCid: null,
      user: null,
      artistId: 'u1',
    });
    mockUserRepo.findOneBy.mockResolvedValue({ id: 'u1', stellarPublicKey: 'GXYZ' });
    const svc = makeSvc();
    await expect(svc.prepareSongMintTx('s1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'SONG_METADATA_NOT_READY',
    });
  });

  it('throws when the artist has no connected Stellar wallet', async () => {
    mockSongRepo.findOne.mockResolvedValue({
      id: 's1',
      metadataCid: 'QmABC',
      user: { id: 'u1', stellarPublicKey: null },
      artistId: 'u1',
    });
    const svc = makeSvc();
    await expect(svc.prepareSongMintTx('s1')).rejects.toMatchObject({
      statusCode: 400,
      code: 'STELLAR_WALLET_REQUIRED',
    });
  });

  it('returns PreparedTransaction on success', async () => {
    const song = { id: 's1', metadataCid: 'QmABC', user: null, artistId: 'u1' };
    mockSongRepo.findOne.mockResolvedValue(song);
    mockUserRepo.findOneBy.mockResolvedValue({ id: 'u1', stellarPublicKey: 'GXYZ' });
    process.env.SOROBAN_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

    const svc = makeSvc();
    mockSorobanInstance.prepareInvocation.mockResolvedValue({
      xdr: 'unsigned-xdr',
      inclusionFee: '100',
    });

    const result = await svc.prepareSongMintTx('s1', 0);

    expect(mockSorobanInstance.prepareInvocation).toHaveBeenCalledWith(
      'GXYZ',
      'CATALOG_CONTRACT',
      'upload_and_mint_song',
      expect.any(Array),
    );
    expect(result).toEqual({
      xdr: 'unsigned-xdr',
      inclusionFee: '100',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
  });
});

describe('SongService.submitSongMintTx', () => {
  it('throws when song is not found', async () => {
    mockSongRepo.findOneBy.mockResolvedValue(null);
    const svc = makeSvc();
    await expect(svc.submitSongMintTx('missing-id', 'signedXdr')).rejects.toMatchObject({
      statusCode: 404,
      code: 'SONG_NOT_FOUND',
    });
  });

  it('leaves a timed-out submission pending with its transaction hash', async () => {
    const song = { id: 's1', mintStatus: 'pending', onChainSongId: null, onChainTokenId: null };
    mockSongRepo.findOneBy.mockResolvedValue(song);
    mockSongRepo.save.mockResolvedValue(song);

    const svc = makeSvc();
    mockSorobanInstance.submitSignedTransaction.mockRejectedValue(new Error('timed out'));

    await expect(svc.submitSongMintTx('s1', 'signedXdr')).rejects.toThrow('timed out');
    expect(song.mintStatus).toBe('pending');
    expect(song.mintTxHash).toBe('precomputed-hash');
    expect(song.mintSubmittedAt).toBeInstanceOf(Date);
    expect(mockSongRepo.save).toHaveBeenCalledWith(song);
  });

  it('marks a definitively failed Soroban transaction as failed', async () => {
    const song = { id: 's1', mintStatus: 'not_minted', onChainSongId: null, onChainTokenId: null };
    mockSongRepo.findOneBy.mockResolvedValue(song);
    mockSongRepo.save.mockResolvedValue(song);

    const svc = makeSvc();
    const { SorobanTransactionFailedError } = jest.requireMock(
      '../services/Soroban/SorobanService',
    );
    mockSorobanInstance.submitSignedTransaction.mockRejectedValue(
      new SorobanTransactionFailedError('transaction failed'),
    );

    await expect(svc.submitSongMintTx('s1', 'signedXdr')).rejects.toThrow('transaction failed');
    expect(song.mintStatus).toBe('failed');
  });

  it('updates song with on-chain IDs and returns txHash on success', async () => {
    const song: any = {
      id: 's1',
      mintStatus: 'pending',
      onChainSongId: null,
      onChainTokenId: null,
    };
    mockSongRepo.findOneBy.mockResolvedValue(song);
    mockSongRepo.save.mockImplementation(async (s: any) => s);

    const svc = makeSvc();
    mockSorobanInstance.getSignedTransactionHash.mockReturnValue('txhash123');
    mockSorobanInstance.submitSignedTransaction.mockResolvedValue({
      hash: 'txhash123',
      returnValue: [BigInt(42), BigInt(7)],
    });

    const result = await svc.submitSongMintTx('s1', 'signedXdr');

    expect(song.mintStatus).toBe('minted');
    expect(song.mintTxHash).toBe('txhash123');
    expect(song.onChainSongId).toBe('42');
    expect(song.onChainTokenId).toBe('7');
    expect(result).toEqual({ txHash: 'txhash123', songId: '42', tokenId: '7' });
  });

  it('reconciles an older pending mint to minted from the RPC result', async () => {
    const song: any = {
      id: 's1',
      mintStatus: 'pending',
      mintTxHash: 'txhash123',
      mintSubmittedAt: new Date(Date.now() - 10 * 60 * 1000),
    };
    mockSongRepo.find.mockResolvedValue([song]);
    mockSongRepo.save.mockImplementation(async (value: any) => value);

    const svc = makeSvc();
    mockSorobanInstance.getTransaction.mockResolvedValue({
      status: 'SUCCESS',
      returnValue: [BigInt(42), BigInt(7)],
    });

    await expect(svc.reconcilePendingMints()).resolves.toBe(1);
    expect(mockSorobanInstance.getTransaction).toHaveBeenCalledWith('txhash123');
    expect(song.mintStatus).toBe('minted');
    expect(song.onChainSongId).toBe('42');
    expect(song.onChainTokenId).toBe('7');
  });

  it.each(['pending', 'minted', 'minting'])(
    'rejects preparing a song already in mint status %s',
    async (mintStatus) => {
      mockSongRepo.findOne.mockResolvedValue({
        id: 's1',
        mintStatus,
        metadataCid: 'QmABC',
        user: { stellarPublicKey: 'GXYZ' },
      });

      const svc = makeSvc();
      await expect(svc.prepareSongMintTx('s1')).rejects.toMatchObject({ statusCode: 409 });
    },
  );
});

describe('SongService.retryFailedSong', () => {
  it('throws when song is not found', async () => {
    mockSongRepo.findOneBy.mockResolvedValue(null);
    const svc = makeSvc();
    await expect(svc.retryFailedSong('missing-id')).rejects.toMatchObject({
      statusCode: 404,
      code: 'SONG_NOT_FOUND',
    });
  });

  it('throws when song status is not failed', async () => {
    mockSongRepo.findOneBy.mockResolvedValue({ id: 's1', status: 'ready' });
    const svc = makeSvc();
    await expect(svc.retryFailedSong('s1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'SONG_NOT_RETRYABLE',
    });
  });

  it('resets status to processing, clears errorReason, and saves on success', async () => {
    const song = { id: 's1', status: 'failed', errorReason: 'Pinata upload timeout' };
    mockSongRepo.findOneBy.mockResolvedValue(song);
    mockSongRepo.save.mockImplementation(async (s: any) => s);

    const svc = makeSvc();
    const result = await svc.retryFailedSong('s1');

    expect(result.status).toBe('processing');
    expect(result.errorReason).toBeNull();
    expect(mockSongRepo.save).toHaveBeenCalledWith(song);
  });
});
