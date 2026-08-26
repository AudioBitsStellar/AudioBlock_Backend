import { Router } from 'express';
import { GenreController } from '../controllers/GenreController';

const router = Router();

// Genre-based browsing (Issue #78). Public, read-only.
router.get('/', GenreController.listGenres);
router.get('/:id/songs', GenreController.getGenreSongs);

export default router;
