import { Router } from 'express';
import { PlaylistController } from '../controllers/PlaylistController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

// All playlist routes require authentication (Issue #77).
router.post('/', requireAuth, PlaylistController.create);
router.get('/', requireAuth, PlaylistController.list);
// Followed playlists (Issue #408) — registered before /:id so it is not
// shadowed by the single-playlist lookup.
router.get('/followed', requireAuth, PlaylistController.listFollowedPlaylists);
router.get('/:id', requireAuth, PlaylistController.getById);
router.put('/:id', requireAuth, PlaylistController.update);
router.delete('/:id', requireAuth, PlaylistController.remove);

// Song association + ordering.
router.post('/:id/songs', requireAuth, PlaylistController.addSong);
router.delete('/:id/songs/:songId', requireAuth, PlaylistController.removeSong);
router.put('/:id/reorder', requireAuth, PlaylistController.reorder);
// Move a single song to a new position (Issue #409).
router.patch('/:id/songs/:songId/position', requireAuth, PlaylistController.moveSong);

// Playlist follow/subscribe (Issue #408).
router.post('/:id/follow', requireAuth, PlaylistController.followPlaylist);
router.delete('/:id/follow', requireAuth, PlaylistController.unfollowPlaylist);

// Collaborative editing (Issue #406).
router.get('/:id/collaborators', requireAuth, PlaylistController.listCollaborators);
router.post('/:id/collaborators', requireAuth, PlaylistController.addCollaborator);
router.put('/:id/collaborators/:userId', requireAuth, PlaylistController.updateCollaboratorRole);
router.delete('/:id/collaborators/:userId', requireAuth, PlaylistController.removeCollaborator);

export default router;
