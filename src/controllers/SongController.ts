import { Request, Response } from 'express';
import AppDataSource from '../config/db';
import { Song } from '../entities/Song';
import redis from '../config/redis';
import { precomputeSignedManifest } from '../workers/precomputeManifest';
import { handleError, handleOnChainError } from '../utils/helpers';
import { AppError } from '../errors/AppError';
import { SongService } from '../services/SongService';
import logger from '../config/logger';

const songService = new SongService();

export class SongController {
  static flagSong = async (req: Request, res: Response) => {
    try {
      const songId = req.params.id as string;
      const adminId = (req as any).user.id as string;
      const { reason } = req.body;
      const song = await songService.flagSong(songId, adminId, reason);
      return res.status(200).json({ success: true, data: song });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static unflagSong = async (req: Request, res: Response) => {
    try {
      const songId = req.params.id as string;
      const adminId = (req as any).user.id as string;
      const song = await songService.unflagSong(songId, adminId);
      return res.status(200).json({ success: true, data: song });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static prepareMint = async (req: Request, res: Response) => {
    try {
      const songId = req.params.id as string;
      const albumId = req.body?.albumId ? Number(req.body.albumId) : 0;
      const prepared = await songService.prepareSongMintTx(songId, albumId);
      return res.status(200).json({ success: true, data: prepared });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static submitMint = async (req: Request, res: Response) => {
    try {
      const songId = req.params.id as string;
      const { signedXdr } = req.body;
      const result = await songService.submitSongMintTx(songId, signedXdr);
      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      handleOnChainError(req, res, error);
    }
  };

  static streamSong = async (req: Request, res: Response) => {
    const songId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    try {
      const songRepo = AppDataSource.getRepository(Song);
      const song = await songRepo.findOne({ where: { id: songId } });
      if (!song || song.status !== 'ready' || !song.hlsMasterUrl || song.flagged) {
        throw AppError.notFound('Song not available', undefined, 'SONG_NOT_AVAILABLE');
      }

      const sessionKey = `play:throttle:${req.ip}:${songId}`;
      const recentlyPlayed = await redis.get(sessionKey);
      if (!recentlyPlayed) {
        await songRepo.increment({ id: songId }, 'playCount', 1);
        await redis.set(sessionKey, '1', 'EX', 30);
      }

      const cacheKey = `manifest:${songId}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.send(cached);
      }

      const generated = await precomputeSignedManifest(songId);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(generated);
    } catch (err) {
      logger.error({ reqId: (req as any).id, route: req.path, err }, 'Stream error');
      handleError(req, res, err);
    }
  };

  static searchSongs = async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string) || '';
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      const songs = await songService.searchSongs(q, limit);

      return res.status(200).json({
        success: true,
        query: q,
        count: songs.length,
        data: songs,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static applyTemplate = async (req: Request, res: Response) => {
    try {
      const songId = req.params.id as string;
      const userId = (req as any).user?.id as string;
      const { templateId } = req.body;

      if (!templateId) {
        return res.status(400).json({ success: false, message: 'templateId is required' });
      }

      const song = await songService.applyTemplate(songId, templateId, userId);
      res.status(200).json({ success: true, data: song });
    } catch (error) {
      handleError(res, error);
    }
  };

  static rebuildSearchIndex = async (req: Request, res: Response) => {
    try {
      const indexed = await songService.rebuildSearchIndex();
      return res.status(200).json({
        success: true,
        message: 'Search index rebuilt',
        indexed,
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static getPopularSongs = async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const songRepo = AppDataSource.getRepository(Song);
      const [songs, total] = await songRepo.findAndCount({
        where: { status: 'ready' },
        order: { playCount: 'DESC' },
        skip,
        take: limit,
      });

      return res.status(200).json({
        success: true,
        data: songs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
