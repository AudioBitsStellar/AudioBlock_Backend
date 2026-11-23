import { Request, Response } from 'express';
import logger from '../config/logger';
import { EmailSuppressionService, parseEmailEvents } from '../services/EmailSuppressionService';

export class EmailEventController {
  /**
   * `POST /api/email-events/:secret`. Records bounce, complaint and drop events so
   * the `email.send` job stops mailing those addresses (issue PROD-03).
   *
   * Storage failures return 500 so the provider retries the delivery. Events that
   * do not suppress anything return 200. Addresses are never logged.
   */
  handleProviderEvents = async (req: Request, res: Response) => {
    const events = parseEmailEvents(req.body);
    try {
      const suppressions = new EmailSuppressionService();
      for (const event of events) {
        await suppressions.suppress(event);
      }
      logger.info(
        { reqId: (req as any).id, suppressed: events.length },
        'Email provider events processed',
      );
      res.status(200).json({ success: true, processed: events.length });
    } catch (error) {
      logger.error(
        { reqId: (req as any).id, err: error },
        'Failed to record email suppression events',
      );
      res.status(500).json({
        success: false,
        message: 'Failed to process email events',
        type: 'INTERNAL_ERROR',
      });
    }
  };
}
