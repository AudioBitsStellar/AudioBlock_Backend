import { Request, Response } from "express";
import AppDataSource from "../config/db";
import { Song } from "../entities/Song";
import redis from "../config/redis";
import { precomputeSignedManifest } from "../workers/precomputeManifest";
import { handleError } from "../utils/helpers";

export class SongController {

  static streamSong = async (req: Request, res: Response) => {
    const songId = req.params.id;
    try {
      const songRepo = AppDataSource.getRepository(Song);
      const song = await songRepo.findOne({ where: { id: songId } });
      if (!song || song.status !== "ready" || !song.hlsMasterUrl) {
        return res.status(404).json({ error: "Song not ready" });
      }

      const cacheKey = `manifest:${songId}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        return res.send(cached);
      }

      // fallback: generate on the fly (fast rewrite)
      const generated = await precomputeSignedManifest(songId);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.send(generated);
    } catch (err) {
      console.error("Stream error:", err);
      handleError(res, err);
    }
  };

  
}
