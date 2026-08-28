import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { PlaylistFollow } from "../entities/PlaylistFollow";
import { handleError } from "../utils/helpers";
import { AppError } from "../errors/AppError";

export class PlaylistFollowController {
  follow = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return handleError(req, res, AppError.authentication("Not authenticated"));

      const { playlistId } = req.body;
      if (!playlistId) return handleError(req, res, AppError.badRequest("playlistId required"));

      const repo = AppDataSource.getRepository(PlaylistFollow);
      const existing = await repo.findOne({ where: { userId, playlistId } });
      if (existing) return res.status(200).json({ follow: existing });

      const follow = repo.create({ userId, playlistId });
      await repo.save(follow);
      res.status(201).json({ follow });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  unfollow = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return handleError(req, res, AppError.authentication("Not authenticated"));

      const { playlistId } = req.params;
      const repo = AppDataSource.getRepository(PlaylistFollow);
      const follow = await repo.findOne({ where: { userId, playlistId } });
      if (!follow) return handleError(req, res, AppError.notFound("Not following this playlist"));

      await repo.remove(follow);
      res.json({ deleted: true });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  getFollowers = async (req: Request, res: Response): Promise<void> => {
    try {
      const { playlistId } = req.params;
      const repo = AppDataSource.getRepository(PlaylistFollow);
      const follows = await repo.find({ where: { playlistId }, relations: ["user"] });
      res.json({ followers: follows.map((f) => f.user), count: follows.length });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  getMyFollows = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return handleError(req, res, AppError.authentication("Not authenticated"));

      const repo = AppDataSource.getRepository(PlaylistFollow);
      const follows = await repo.find({ where: { userId }, relations: ["playlist"] });
      res.json({ playlists: follows.map((f) => f.playlist) });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
