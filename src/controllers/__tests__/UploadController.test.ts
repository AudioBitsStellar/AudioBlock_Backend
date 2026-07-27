import { UploadController } from '../UploadController';

// Factory mock (not a bare auto-mock): SongService transitively imports
// @stellar/stellar-sdk, whose CJS build requires an ESM-only @noble/hashes
// file ts-jest can't parse. A factory avoids ever loading the real module.
// Named mock fns (prefixed "mock") are referenced directly rather than via
// `SongService.mock.instances`, since UploadController holds its own
// module-scope `songService` instance created at import time.
const mockSaveChunk = jest.fn();
const mockSaveCover = jest.fn();
const mockFinalizeUpload = jest.fn();
jest.mock('../../services/SongService', () => ({
  SongService: jest.fn().mockImplementation(() => ({
    saveChunk: mockSaveChunk,
    saveCover: mockSaveCover,
    finalizeUpload: mockFinalizeUpload,
  })),
}));

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('UploadController', () => {
  let controller: UploadController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new UploadController();
  });

  describe('uploadChunk', () => {
    it('rejects with 400 when no chunk file is present', async () => {
      const req: any = { body: { fileId: 'f1', chunkIndex: '0' } };
      const res = mockRes();

      await controller.uploadChunk(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockSaveChunk).not.toHaveBeenCalled();
    });

    it('saves a valid chunk and returns success', async () => {
      mockSaveChunk.mockResolvedValue(undefined);
      const req: any = { body: { fileId: 'f1', chunkIndex: '2' }, file: { path: '/tmp/chunk-2' } };
      const res = mockRes();

      await controller.uploadChunk(req, res);

      expect(mockSaveChunk).toHaveBeenCalledWith('f1', 2, '/tmp/chunk-2');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('uploadCover', () => {
    it('rejects with 400 when no cover file is present', async () => {
      const req: any = { body: { fileId: 'f1' } };
      const res = mockRes();

      await controller.uploadCover(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockSaveCover).not.toHaveBeenCalled();
    });

    it('saves a valid cover and returns success', async () => {
      mockSaveCover.mockResolvedValue({ path: '/covers/f1.jpg' });
      const req: any = { body: { fileId: 'f1' }, file: { path: '/tmp/cover.jpg' } };
      const res = mockRes();

      await controller.uploadCover(req, res);

      expect(mockSaveCover).toHaveBeenCalledWith('f1', '/tmp/cover.jpg');
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('finalizeUpload', () => {
    function baseReq(overrides: any = {}) {
      return {
        body: {
          fileId: 'f1',
          totalChunks: '3',
          title: 'Track',
          description: 'desc',
          genre: 'afrobeats',
          coverArtPath: '/covers/f1.jpg',
          composers: [],
        },
        user: { id: 'artist-1', walletAddress: 'GABC...' },
        path: '/upload/finalize',
        ...overrides,
      };
    }

    it('returns 201 with the created song on success', async () => {
      const song = { id: 'song-1', title: 'Track' };
      mockFinalizeUpload.mockResolvedValue(song);
      const res = mockRes();

      await controller.finalizeUpload(baseReq() as any, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: song }));
    });

    it('returns 422 with a clear message when malware is detected', async () => {
      const malwareError: any = new Error('File flagged by malware scanner');
      malwareError.code = 'MALWARE_DETECTED';
      malwareError.threat = 'EICAR-Test-Signature';
      mockFinalizeUpload.mockRejectedValue(malwareError);
      const res = mockRes();

      await controller.finalizeUpload(baseReq() as any, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'MALWARE_DETECTED' }),
        }),
      );
    });

    it('falls through to generic error handling for other failures', async () => {
      mockFinalizeUpload.mockRejectedValue(new Error('disk full'));
      const res = mockRes();

      await controller.finalizeUpload(baseReq() as any, res);

      expect(res.status).not.toHaveBeenCalledWith(201);
      expect(res.status).not.toHaveBeenCalledWith(422);
    });
  });
});
