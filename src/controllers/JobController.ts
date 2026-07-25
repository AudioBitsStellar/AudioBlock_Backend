import { Request, Response } from 'express';
import { JobQueueService } from '../services/JobQueueService';
import { handleError } from '../utils/helpers';

/**
 * Admin-facing visibility into the background job queue (Issue #132).
 */
export class JobController {
  /** GET /api/admin/jobs — queue depth, per-status counts and DLQ contents. */
  static getJobs = async (req: Request, res: Response) => {
    try {
      const stats = await JobQueueService.getStats();
      const deadLetter = await JobQueueService.getDeadLetterJobs(50);

      return res.status(200).json({
        success: true,
        data: {
          ...stats,
          warnThreshold: JobQueueService.warnThreshold,
          deadLetter,
        },
      });
    } catch (error) {
      handleError(res, error);
    }
  };

  /** GET /api/admin/jobs/:id — inspect a single job's metadata. */
  static getJob = async (req: Request, res: Response) => {
    try {
      const job = await JobQueueService.getJob(req.params.id as string);
      if (!job) {
        return res.status(404).json({ success: false, message: 'Job not found' });
      }
      return res.status(200).json({ success: true, data: job });
    } catch (error) {
      handleError(res, error);
    }
  };
}
