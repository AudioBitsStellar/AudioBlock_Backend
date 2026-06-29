import { Router } from "express";
import { requireRoles } from "../middlewares/authMiddleware";
import { UserRole } from "../entities/User";
import { SongController } from "../controllers/SongController";

const router = Router();

router.use(requireRoles(UserRole.ADMIN));

router.patch("/song/:id/flag", SongController.flagSong);
router.patch("/song/:id/unflag", SongController.unflagSong);

export default router;
