import { Router } from "express";
import { EmbedController } from "../controllers/EmbedController";

const router = Router();

// Public embed endpoints — no auth required, rate-limited via Redis (same as streaming)
router.get("/song/:id", EmbedController.getSongEmbed);
router.get("/album/:id", EmbedController.getAlbumEmbed);

// Alternative alias matching SongRoutes expectation: /embed/song/:id already above
// Also support /song/embed/:id via SongRoutes; this file serves /api/embed/*

export default router;
