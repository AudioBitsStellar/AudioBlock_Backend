import { Request, Response } from "express";
import { Application } from "express";
import { BatchRequestItem, BatchResponseItem } from "../types/BatchTypes";
import { BatchService } from "../services/BatchService";
import logger from "../config/logger";

const MAX_BATCH_SIZE = 10;
const MAX_BODY_BYTES = 100 * 1024; // 100 KB

export class BatchController {
  private service: BatchService;

  constructor(app: Application) {
    this.service = new BatchService(app);
  }

  handle = async (req: Request, res: Response): Promise<void> => {
    try {
      const rawSize =
        parseInt(req.headers["content-length"] as string, 10) ||
        Buffer.byteLength(JSON.stringify(req.body), "utf8");

      if (rawSize > MAX_BODY_BYTES) {
        res.status(413).json({
          success: false,
          error: "Request body exceeds 100KB batch limit",
        });
        return;
      }

      const items: unknown[] = req.body;

      if (!Array.isArray(items)) {
        res.status(400).json({
          success: false,
          error: "Request body must be an array of { method, path, body? }",
        });
        return;
      }

      if (items.length === 0) {
        res.status(200).json({ success: true, data: [] });
        return;
      }

      if (items.length > MAX_BATCH_SIZE) {
        res.status(400).json({
          success: false,
          error: `Batch limited to ${MAX_BATCH_SIZE} sub-requests`,
        });
        return;
      }

      const parentHeaders = req.headers as Record<string, string | string[] | undefined>;

      const results: BatchResponseItem[] = await Promise.all(
        items.map(async (item, index) => {
          if (!item || typeof item !== "object") {
            return { status: 400, body: { error: "Invalid sub-request: must be an object" } };
          }

          const { method, path, body } = item as BatchRequestItem;

          if (!method || !path) {
            return { status: 400, body: { error: "Each sub-request requires method and path" } };
          }

          const allowed = ["GET", "POST", "PUT", "PATCH", "DELETE"];
          if (!allowed.includes(method.toUpperCase())) {
            return {
              status: 400,
              body: { error: `Unsupported method: ${method}` },
            };
          }

          logger.debug(
            { index, method, path },
            "Processing batch sub-request"
          );

          try {
            return await this.service.dispatch({ method, path, body }, parentHeaders);
          } catch (err) {
            logger.error(
              { index, method, path, err },
              "Sub-request failed unexpectedly"
            );
            return {
              status: 500,
              body: { error: "Internal sub-request error" },
            };
          }
        })
      );

      res.status(200).json({ success: true, data: results });
    } catch (err) {
      logger.error({ err }, "Batch endpoint error");
      res.status(500).json({
        success: false,
        error: "Batch processing failed",
      });
    }
  };
}
