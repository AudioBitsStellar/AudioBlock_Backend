import { Router, Application } from 'express';
import { BatchController } from '../controllers/BatchController';

export function createBatchRoutes(app: Application): Router {
  const router = Router();
  const controller = new BatchController(app);

  router.post('/', controller.handle);

  return router;
}
