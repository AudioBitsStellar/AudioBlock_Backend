import { Request, Response } from 'express';
import { SongController } from '../../src/controllers/SongController';
import { SongService } from '../../src/services/SongService';
import * as utils from '../../src/utils/helpers';

// Mock the SongService class
jest.mock('../../src/services/SongService');

describe('SongController - getLyrics', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let mockGetLyrics: jest.Mock;

  beforeEach(() => {
    mockGetLyrics = jest.fn();
    (SongService.prototype.getLyrics as jest.Mock) = mockGetLyrics;

    req = {
      params: { id: 'song-123' },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return lyrics for a valid song', async () => {
    mockGetLyrics.mockResolvedValue({ lyrics: 'La la la', language: 'en' });

    await SongController.getLyrics(req as Request, res as Response);

    expect(mockGetLyrics).toHaveBeenCalledWith('song-123');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { lyrics: 'La la la', language: 'en' },
    });
  });

  it('should call handleError on failure', async () => {
    const error = new Error('Test error');
    mockGetLyrics.mockRejectedValue(error);

    // We mock handleError using spyOn if possible, but actually handleError is in utils.
    // Instead of asserting handleError, we just test that it catches the error and doesn't throw.
    jest.spyOn(utils, 'handleError').mockImplementation(() => {});

    await SongController.getLyrics(req as Request, res as Response);

    expect(utils.handleError).toHaveBeenCalledWith(req, res, error);
  });
});
