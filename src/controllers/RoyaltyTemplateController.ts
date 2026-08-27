import { Request, Response } from 'express';
import { RoyaltyTemplateService } from '../services/RoyaltyTemplateService';
import { SongService } from '../services/SongService';
import logger from '../config/logger';
import { handleError } from '../utils/helpers';

const templateService = new RoyaltyTemplateService();
const songService = new SongService();

export class RoyaltyTemplateController {
  create = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const { name, splits } = req.body;
      if (!name || !splits || !Array.isArray(splits)) {
        return res.status(400).json({
          success: false,
          message: 'Name and splits array are required',
        });
      }

      const template = await templateService.create({ name, userId, splits });
      res.status(201).json({ success: true, data: template });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'createTemplate error');
      handleError(res, error);
    }
  };

  list = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const templates = await templateService.findByUser(userId);
      res.status(200).json({ success: true, data: templates });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'listTemplates error');
      handleError(res, error);
    }
  };

  update = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const templateId = req.params.id as string;
      const { name, splits } = req.body;

      const template = await templateService.update(templateId, userId, { name, splits });
      res.status(200).json({ success: true, data: template });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'updateTemplate error');
      handleError(res, error);
    }
  };

  delete = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const templateId = req.params.id as string;
      await templateService.delete(templateId, userId);
      res.status(200).json({ success: true, message: 'Template deleted' });
    } catch (error) {
      logger.error({ reqId: (req as any).id, route: req.path, err: error }, 'deleteTemplate error');
      handleError(res, error);
    }
  };
}
