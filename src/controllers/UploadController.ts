import { Request, Response } from 'express';
import { handleError } from '../utils/helpers';
import { AppError, ErrorType } from '../errors/AppError';
import { SongService } from '../services/SongService';
import logger from '../config/logger';

const songService = new SongService();

export class UploadController {
  uploadChunk = async (req: Request, res: Response) => {
    try {
      const { fileId, chunkIndex } = req.body;

      if (!req.file) {
        throw AppError.validation('No chunk file uploaded');
      }

      await songService.saveChunk(fileId, Number(chunkIndex), req.file.path);

      return res.status(200).json({ success: true });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  uploadCover = async (req: Request, res: Response) => {
    try {
      const { fileId } = req.body;
      if (!req.file) {
        throw AppError.validation('No cover file uploaded');
      }
      const coverPath = req.file.path;
      const cover = await songService.saveCover(fileId, coverPath);
      res.status(200).json({ success: true, message: 'Cover uploaded', data: { fileId, cover } });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  /**
   * Once all chunks are uploaded, merge, scan for malware, and push to RabbitMQ.
   *
   * If the merged file is flagged by the malware scanner the artist receives a
   * 422 response with a `MALWARE_DETECTED` code so the dashboard can display
   * a clear error message (Issue #38).
   */
  finalizeUpload = async (req: Request, res: Response) => {
    try {
      const { fileId, totalChunks, title, description, genre, coverArtPath, composers } = req.body;

      const user = (req as any).user;

      const artistId = user.id;
      const artistAddress = user.walletAddress;

      const song = await songService.finalizeUpload({
        fileId,
        totalChunks: Number(totalChunks),
        title,
        artistId,
        artistAddress,
        description,
        genre,
        coverArtPath,
        composers,
      });
      return res.status(201).json({ success: true, data: song });
    } catch (err: any) {
      // Surface malware detection as a 422 with a clear artist-facing message
      if (err?.code === 'MALWARE_DETECTED') {
        logger.warn(
          { reqId: (req as any).id, route: req.path, threat: err.threat },
          'Upload rejected due to malware detection',
        );
        return handleError(
          res,
          new AppError(
            err.message,
            ErrorType.VALIDATION_FAILED,
            422,
            true,
            undefined,
            'MALWARE_DETECTED',
          ),
        );
      }
      logger.error({ reqId: (req as any).id, route: req.path, err }, 'finalizeUpload error');
      handleError(req, res, err);
    }
  };

  /**
   * POST /api/song/:id/reupload — finalize a re-upload as a new song version
   * (Issue #86).
   *
   * Chunks are uploaded through the existing `/upload/chunk` endpoint; this
   * call merges them, scans, and appends a new active version rather than
   * overwriting the previous audio.
   */
  finalizeReupload = async (req: Request, res: Response) => {
    try {
      const songId = req.params.id as string;
      const {
        fileId,
        totalChunks,
        title,
        description,
        genre,
        coverArtPath,
        composers,
        changeNote,
      } = req.body;

      const artistId = (req as any).user.id as string;

      const result = await songService.finalizeReupload(
        songId,
        fileId,
        Number(totalChunks),
        artistId,
        { title, description, genre, coverArtPath, composers, changeNote },
      );

      return res.status(201).json({
        success: true,
        message: `Version ${result.version.versionNumber} created`,
        data: { song: result.song, version: result.version },
      });
    } catch (err: any) {
      if (err?.code === 'MALWARE_DETECTED') {
        logger.warn(
          { reqId: (req as any).id, route: req.path, threat: err.threat },
          'Re-upload rejected due to malware detection',
        );
        return handleError(
          req,
          res,
          new AppError(
            err.message,
            ErrorType.VALIDATION_FAILED,
            422,
            true,
            undefined,
            'MALWARE_DETECTED',
          ),
        );
      }
      logger.error({ reqId: (req as any).id, route: req.path, err }, 'finalizeReupload error');
      handleError(req, res, err);
    }
  };
}
