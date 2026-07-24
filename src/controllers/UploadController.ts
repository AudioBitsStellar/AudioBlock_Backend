import { Request, Response } from "express";
import { handleError } from "../utils/helpers";
import { SongService } from "../services/SongService";
import logger from "../config/logger";

const songService = new SongService();

export class UploadController {
  uploadChunk =
    async (req: Request, res: Response) => {
      try {
        const { fileId, chunkIndex } = req.body;

        if (!req.file) {
          return res.status(400).json({ error: "No chunk file uploaded" });
        }

        await songService.saveChunk(fileId, Number(chunkIndex), req.file.path);

        return res.status(200).json({ success: true });
      } catch (error) {
        handleError(res, error);
      }
    }

  uploadCover = 
    async (req: Request, res: Response) => {
      try {
        const { fileId } = req.body;
        if (!req.file) {
          return res.status(400).json({success: false, error: "No cover file uploaded" });
        }
        const coverPath = req.file.path;
        const cover = await songService.saveCover(fileId, coverPath);
        res.status(200).json({ success: true, message: "Cover uploaded", data: {fileId, cover} });
      } catch (error) {
        handleError(res, error);
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

      const song = await songService.finalizeUpload(
        fileId,
        Number(totalChunks),
        title,
        artistId,
        artistAddress,
        description,
        genre,
        coverArtPath,
        composers
      );
      return res.status(201).json({ success: true, data: song });
    } catch (err: any) {
      // Surface malware detection as a 422 with a clear artist-facing message
      if (err?.code === "MALWARE_DETECTED") {
        logger.warn(
          { reqId: (req as any).id, route: req.path, threat: err.threat },
          "Upload rejected due to malware detection"
        );
        return res.status(422).json({
          success: false,
          error: "MALWARE_DETECTED",
          message: err.message,
        });
      }
      logger.error({ reqId: (req as any).id, route: req.path, err }, "finalizeUpload error");
      handleError(res, err);
    }
  };
}
