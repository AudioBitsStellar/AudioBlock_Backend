import { Request, Response } from 'express';
import { AppError } from '../../errors/AppError';

jest.mock('../../services/SongService', () => {
  const prepareSongMintTx = jest.fn();
  return {
    SongService: jest.fn().mockImplementation(() => ({ prepareSongMintTx })),
    __mocks: { prepareSongMintTx },
  };
});

jest.mock('../../services/CollaborationService', () => ({
  CollaborationService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../services/TagService', () => ({
  TagService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../services/Song/SongStatsService', () => ({
  SongStatsService: jest.fn().mockImplementation(() => ({})),
  parseWindow: jest.fn(),
}));
jest.mock('../../services/Song/SongVersionService', () => ({
  SongVersionService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../services/ReportService', () => ({
  ReportService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../services/Song/PlaybackService', () => ({
  PlaybackService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../services/CoverArtService', () => ({
  CoverArtService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  },
}));

import { SongController } from '../SongController';

const mockPrepareSongMintTx = jest.requireMock('../../services/SongService').__mocks
  .prepareSongMintTx as jest.Mock;

function createResponse() {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & { status: jest.Mock; json: jest.Mock };
}

describe('SongController.prepareMint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 404 for a missing song instead of a server error', async () => {
    mockPrepareSongMintTx.mockRejectedValue(
      AppError.notFound('Song not found', undefined, 'SONG_NOT_FOUND'),
    );
    const req = {
      params: { id: 'missing-song' },
      body: {},
      path: '/api/song/missing-song/onchain/prepare-mint',
    } as unknown as Request;
    const res = createResponse();

    await SongController.prepareMint(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Song not found' }),
    );
  });
});
