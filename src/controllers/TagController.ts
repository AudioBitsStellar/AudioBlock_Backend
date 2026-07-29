import { Request, Response } from 'express';
import { TagService } from '../services/TagService';
import { handleError } from '../utils/helpers';
import { AppError } from '../errors/AppError';

const tagService = new TagService();

export class TagController {
  static listAll = async (req: Request, res: Response) => {
    try {
      const grouped = await tagService.listAllGroupedByCategory();
      return res.status(200).json({ success: true, data: grouped });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static getSongsByTag = async (req: Request, res: Response) => {
    try {
      const slug = req.params.slug as string;
      const songs = await tagService.getSongsByTagSlug(slug);
      return res.status(200).json({ success: true, data: songs });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  static addTagsToSong = async (req: Request, res: Response) => {
    try {
      const songId = req.params.id as string;
      const { tags, category } = req.body;

      if (!Array.isArray(tags) || tags.length === 0) {
        throw AppError.validation('tags must be a non-empty array of tag names');
      }

      const result = await tagService.addTagsToSong(songId, tags, category);
      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
