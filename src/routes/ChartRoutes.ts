import { Router } from 'express';
import { ChartController } from '../controllers/ChartController';
import { etagCache } from '../middlewares/etag';

const router = Router();

router.get(
  '/trending',
  etagCache({ visibility: 'public', maxAge: 60 }),
  ChartController.getTrending,
);

export default router;
