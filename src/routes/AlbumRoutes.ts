import express from 'express';
import AlbumController from '../controllers/AlbumController';

const router = express.Router();

// GET /api/album?page=1&limit=20&artistId=...
router.get('/', AlbumController.list);

export default router;
