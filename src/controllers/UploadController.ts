import { Request, Response } from "express";
import multer from "multer";
import { handleError } from "../utils/helpers";
import { SongService } from "../services/SongService";
const songService = new SongService();

export class UploadController {
  uploadChunk = 
    async (req: Request, res: Response) => {
      try {
        const { fileId, chunkIndex } = req.body;

        if (!req.file) {
          return res.status(400).json({ error: "No chunk file uploaded" });
        }
        if (!req.file.mimetype.startsWith("audio/")) {
          throw new Error("Invalid file type. Only audio files are allowed.");
        }

        const chunkFile = req.file!;
        // await songService.saveChunk(fileId, Number(chunkIndex), chunkFile.path);
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
   * Once all chunks are uploaded, merge and push to RabbitMQ
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
    } catch (err) {
      console.error(err);
      handleError(res, err);
    }
  };
}
