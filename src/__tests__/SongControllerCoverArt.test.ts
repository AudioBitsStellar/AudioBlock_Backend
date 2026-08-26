import 'reflect-metadata';

const mockUploadCoverArt = jest.fn();
const mockGetCoverArt = jest.fn();

jest.mock('../services/CoverArtService', () => ({
  CoverArtService: jest.fn().mockImplementation(() => ({
    uploadCoverArt: mockUploadCoverArt,
    getCoverArt: mockGetCoverArt,
  })),
}));
jest.mock('../services/SongService', () => ({
  SongService: jest.fn().mockImplementation(() => ({})),
}));

import { SongController } from '../controllers/SongController';
import { Request, Response } from 'express';

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    user: { id: 'user-1' },
    ...overrides,
  } as unknown as Request;
}

function mockRes(): { res: Response; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  return { res: { json, status } as unknown as Response, json, status };
}

beforeEach(() => {
  mockUploadCoverArt.mockReset();
  mockGetCoverArt.mockReset();
});

describe('SongController.uploadCoverArt', () => {
  it('uploads and associates cover art', async () => {
    const song = { id: 's1', coverArtIpfsHash: 'cid-main', coverArtThumbnails: {} };
    mockUploadCoverArt.mockResolvedValue(song);

    const file = { originalname: 'cover.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('x') };
    const req = mockReq({ params: { id: 's1' }, file });
    const { res, json } = mockRes();

    await SongController.uploadCoverArt(req, res);

    expect(mockUploadCoverArt).toHaveBeenCalledWith('s1', 'user-1', file);
    expect(json).toHaveBeenCalledWith({ success: true, data: song });
  });

  it('rejects a request without a file', async () => {
    const req = mockReq({ params: { id: 's1' } });
    const { res, status } = mockRes();

    await SongController.uploadCoverArt(req, res);

    expect(mockUploadCoverArt).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
  });
});

describe('SongController.getCoverArt', () => {
  it('returns cover art URLs including thumbnails', async () => {
    mockGetCoverArt.mockResolvedValue({
      songId: 's1',
      coverArtPath: 'https://gateway/ipfs/cid-main',
      coverArtIpfsHash: 'cid-main',
      thumbnails: { '150': 'https://gateway/ipfs/cid-150' },
    });

    const req = mockReq({ params: { id: 's1' } });
    const { res, json } = mockRes();

    await SongController.getCoverArt(req, res);

    expect(mockGetCoverArt).toHaveBeenCalledWith('s1');
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ coverArtIpfsHash: 'cid-main' }),
    });
  });
});
