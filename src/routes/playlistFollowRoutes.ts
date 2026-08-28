import { Router } from "express";
import { PlaylistFollowController } from "../controllers/PlaylistFollowController";
import { requireAuth } from "../middlewares/authMiddleware";

const router = Router();
const c = new PlaylistFollowController();

router.post("/follow", requireAuth, c.follow);
router.delete("/follow/:playlistId", requireAuth, c.unfollow);
router.get("/followed", requireAuth, c.getMyFollows);
router.get("/:playlistId/followers", requireAuth, c.getFollowers);

export default router;
