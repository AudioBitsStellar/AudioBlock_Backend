import { Request, Response } from "express";
import { TakedownService } from "../services/TakedownService";
import { TakedownReason } from "../entities/TakedownRequest";
import { handleError } from "../utils/helpers";

const takedownService = new TakedownService();

export class TakedownController {
  static create = async (req: Request, res: Response) => {
    try {
      const requestedBy = (req as any).user?.id;
      if (!requestedBy) return res.status(401).json({ success: false, message: "Unauthorized" });

      const { songId, reason, description, evidenceUrl } = req.body;
      if (!songId) return res.status(400).json({ success: false, message: "songId is required" });

      const takedown = await takedownService.createRequest(
        requestedBy,
        songId,
        (reason as TakedownReason) || TakedownReason.COPYRIGHT,
        description,
        evidenceUrl
      );
      return res.status(201).json({ success: true, data: takedown });
    } catch (error: any) {
      if (error.statusCode === 404) return res.status(404).json({ success: false, message: error.message });
      handleError(res, error);
    }
  };

  static list = async (req: Request, res: Response) => {
    try {
      const { status, songId } = req.query as any;
      const data = await takedownService.listRequests({ status, songId });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      handleError(res, error);
    }
  };

  static getOne = async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const data = await takedownService.getRequest(id);
      return res.status(200).json({ success: true, data });
    } catch (error: any) {
      if (error.statusCode === 404) return res.status(404).json({ success: false, message: error.message });
      handleError(res, error);
    }
  };

  static review = async (req: Request, res: Response) => {
    try {
      const adminId = (req as any).user?.id;
      if (!adminId) return res.status(401).json({ success: false, message: "Unauthorized" });
      const id = req.params.id as string;
      const { action, reviewNotes } = req.body;
      if (!action || !["approve", "reject", "reverse"].includes(action)) {
        return res.status(400).json({ success: false, message: "action must be approve|reject|reverse" });
      }
      const updated = await takedownService.reviewRequest(id, adminId, action, reviewNotes);
      return res.status(200).json({ success: true, data: updated });
    } catch (error: any) {
      if (error.statusCode === 404) return res.status(404).json({ success: false, message: error.message });
      handleError(res, error);
    }
  };
}
