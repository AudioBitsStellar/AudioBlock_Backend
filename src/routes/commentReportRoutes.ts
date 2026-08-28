import { Router } from "express";
import { CommentReportController } from "../controllers/CommentReportController";
import { requireAuth } from "../middlewares/authMiddleware";

const router = Router();
const c = new CommentReportController();

// Any authenticated user can flag a comment
router.post("/flag", requireAuth, c.flag);

// Moderators: view pending queue and resolve reports
router.get("/queue", requireAuth, c.getQueue);
router.post("/:id/resolve", requireAuth, c.resolve);

export default router;
