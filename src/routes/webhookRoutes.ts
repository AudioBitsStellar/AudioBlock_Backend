import { Router } from "express";
import { WebhookController } from "../controllers/WebhookController";
import { requireAuth } from "../middlewares/authMiddleware";
import { validateDTO } from "../middlewares/validate";
import { CreateWebhookSubscriptionDTO } from "../dtos/WebhookSubscriptionDTO";

const router = Router();

// All webhook subscription management requires authentication (any role)
router.post("/register", requireAuth, validateDTO(CreateWebhookSubscriptionDTO), WebhookController.register);
router.get("/", requireAuth, WebhookController.list);
router.delete("/:id", requireAuth, WebhookController.remove);
router.post("/:id/test", requireAuth, WebhookController.testDelivery);

export default router;
