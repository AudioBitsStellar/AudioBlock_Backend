import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { FanPerk } from "../entities/FanPerk";
import { handleError } from "../utils/helpers";
import { AppError } from "../errors/AppError";

export class FanPerkController {
  listPerks = async (req: Request, res: Response): Promise<void> => {
    try {
      const { artistId } = req.params;
      const repo = AppDataSource.getRepository(FanPerk);
      const perks = await repo.find({
        where: { artistId, hidden: false },
        order: { sortOrder: "ASC", createdAt: "DESC" },
      });
      res.json({ perks });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  listMyPerks = async (req: Request, res: Response): Promise<void> => {
    try {
      const artistId = (req as any).userId;
      const repo = AppDataSource.getRepository(FanPerk);
      const perks = await repo.find({
        where: { artistId },
        order: { sortOrder: "ASC", createdAt: "DESC" },
      });
      res.json({ perks });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  createPerk = async (req: Request, res: Response): Promise<void> => {
    try {
      const artistId = (req as any).userId;
      const { tier, name, description, perkType, resourceUrl, discountPercent, hidden, sortOrder } = req.body;
      if (!tier || !name) {
        return handleError(req, res, AppError.badRequest("tier and name are required"));
      }
      const repo = AppDataSource.getRepository(FanPerk);
      const perk = repo.create({
        artistId,
        tier,
        name,
        description: description || null,
        perkType: perkType || "custom",
        resourceUrl: resourceUrl || null,
        discountPercent: discountPercent || null,
        hidden: hidden || false,
        sortOrder: sortOrder || 0,
      });
      await repo.save(perk);
      res.status(201).json({ perk });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  updatePerk = async (req: Request, res: Response): Promise<void> => {
    try {
      const artistId = (req as any).userId;
      const { id } = req.params;
      const repo = AppDataSource.getRepository(FanPerk);
      const perk = await repo.findOneBy({ id, artistId });
      if (!perk) {
        return handleError(req, res, AppError.notFound("Perk not found"));
      }
      Object.assign(perk, req.body);
      await repo.save(perk);
      res.json({ perk });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  deletePerk = async (req: Request, res: Response): Promise<void> => {
    try {
      const artistId = (req as any).userId;
      const { id } = req.params;
      const repo = AppDataSource.getRepository(FanPerk);
      const perk = await repo.findOneBy({ id, artistId });
      if (!perk) {
        return handleError(req, res, AppError.notFound("Perk not found"));
      }
      await repo.remove(perk);
      res.json({ deleted: true });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
