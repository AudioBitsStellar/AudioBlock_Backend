import { Request, Response } from "express";
import { AppDataSource } from "../config/data-source";
import { CommentReport, CommentReportStatus } from "../entities/CommentReport";
import { handleError } from "../utils/helpers";
import { AppError } from "../errors/AppError";

export class CommentReportController {
  flag = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return handleError(req, res, AppError.authentication("Not authenticated"));

      const { commentId, reason, description } = req.body;
      if (!commentId) return handleError(req, res, AppError.badRequest("commentId required"));

      const repo = AppDataSource.getRepository(CommentReport);
      const existing = await repo.findOne({ where: { commentId, reporterId: userId } });
      if (existing) return handleError(req, res, AppError.conflict("Already flagged this comment"));

      const report = repo.create({
        commentId,
        reporterId: userId,
        reason: reason || "other",
        description: description || null,
      });
      await repo.save(report);
      res.status(201).json({ report });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  getQueue = async (req: Request, res: Response): Promise<void> => {
    try {
      const repo = AppDataSource.getRepository(CommentReport);
      const reports = await repo.find({
        where: { status: CommentReportStatus.PENDING },
        relations: ["comment", "reporter"],
        order: { createdAt: "ASC" },
      });
      res.json({ reports, count: reports.length });
    } catch (error) {
      handleError(req, res, error);
    }
  };

  resolve = async (req: Request, res: Response): Promise<void> => {
    try {
      const moderatorId = (req as any).user?.id;
      const { id } = req.params;
      const { action, note } = req.body;

      const repo = AppDataSource.getRepository(CommentReport);
      const report = await repo.findOneBy({ id });
      if (!report) return handleError(req, res, AppError.notFound("Report not found"));

      report.status = CommentReportStatus.RESOLVED;
      report.actionTaken = action || "no_action";
      report.resolvedBy = moderatorId;
      report.resolvedAt = new Date();
      report.resolutionNote = note || null;
      await repo.save(report);

      res.json({ report });
    } catch (error) {
      handleError(req, res, error);
    }
  };
}
