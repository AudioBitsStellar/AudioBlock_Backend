import { Router } from "express";
import { requireRoles } from "../middlewares/authMiddleware";
import { UserRole } from "../entities/User";
import { SongController } from "../controllers/SongController";
import { JobController } from "../controllers/JobController";

const router = Router();

router.use(requireRoles(UserRole.ADMIN));

router.patch("/song/:id/flag", SongController.flagSong);
router.patch("/song/:id/unflag", SongController.unflagSong);

// Search index maintenance (Issue #135)
router.post("/search/rebuild", SongController.rebuildSearchIndex);

// Background job queue visibility (Issue #132)
router.get("/jobs", JobController.getJobs);
router.get("/jobs/:id", JobController.getJob);

export default router;
