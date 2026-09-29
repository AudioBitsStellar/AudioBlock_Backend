import { Router } from 'express';
import logger from '../config/logger';
import { getMetrics, getMetricsContentType } from '../services/MetricsService';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    res.set('Content-Type', await getMetricsContentType());
    res.status(200).send(await getMetrics());
  } catch (error) {
    logger.error({ err: error }, 'Failed to render Prometheus metrics');
    res.status(500).type('text/plain').send('Metrics temporarily unavailable');
  }
});

export default router;
