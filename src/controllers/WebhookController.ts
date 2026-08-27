import { Request, Response } from "express";
import { WebhookService } from "../services/WebhookService";
import { handleError } from "../utils/helpers";

const webhookService = new WebhookService();

export class WebhookController {
  static register = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      const { endpoint, eventTypes, secret } = req.body;
      if (!endpoint) return res.status(400).json({ success: false, message: "endpoint is required" });

      const subscription = await webhookService.registerSubscription(userId, endpoint, eventTypes, secret);
      return res.status(201).json({ success: true, data: subscription });
    } catch (error) {
      handleError(res, error);
    }
  };

  static list = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
      const subs = await webhookService.listSubscriptions(userId);
      return res.status(200).json({ success: true, data: subs });
    } catch (error) {
      handleError(res, error);
    }
  };

  static remove = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
      const id = req.params.id as string;
      await webhookService.deleteSubscription(userId, id);
      return res.status(200).json({ success: true, message: "Webhook subscription deleted" });
    } catch (error) {
      handleError(res, error);
    }
  };

  /** Test delivery — useful for verifying endpoint */
  static testDelivery = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const id = req.params.id as string;
      // Simple test: publish a test event to this subscription only if owned
      const subs = await webhookService.listSubscriptions(userId);
      const target = subs.find((s) => s.id === id);
      if (!target) return res.status(404).json({ success: false, message: "Subscription not found" });

      const payload: any = {
        eventId: `test-${Date.now()}`,
        eventType: "test.event",
        timestamp: new Date().toISOString(),
        message: "Test webhook delivery",
      };
      await (webhookService as any).deliver(target.endpoint, payload, target.secret);
      return res.status(200).json({ success: true, message: "Test event delivered" });
    } catch (error) {
      handleError(res, error);
    }
  };
}
