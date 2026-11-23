/**
 * Standalone song-processing worker (`npm run start:worker` in the image,
 * `npm run worker` in development).
 *
 * This is its own deployable (Issue #965): the API process also starts this
 * consumer today, but production runs it separately so a transcoding backlog
 * cannot starve request handling and so it can be scaled on queue depth.
 */
import 'reflect-metadata';
import 'dotenv/config';
import AppDataSource from '../config/db';
import { initRabbitMQ, closeRabbitMQConnection } from '../config/rabbitmq';
import { startSongWorker } from './SongProcessorWorker';
import logger from '../config/logger';
import {
  RoleHealthServer,
  resolveHealthPort,
  startRoleHealthServer,
} from '../utils/roleHealthServer';

async function main(): Promise<void> {
  await AppDataSource.initialize();

  // Bind health before the queue work so a container that cannot start its
  // consumer is still probeable (and therefore reportable) rather than opaque.
  let consumerStarted = false;
  const health: RoleHealthServer = await startRoleHealthServer({
    role: 'worker',
    port: resolveHealthPort('worker'),
    isReady: () => consumerStarted,
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down standalone song worker');
    void health
      .close()
      .catch(() => undefined)
      .then(() => closeRabbitMQConnection().catch(() => undefined))
      .then(() => (AppDataSource.isInitialized ? AppDataSource.destroy() : undefined))
      .catch(() => undefined)
      .then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await initRabbitMQ();
  consumerStarted = await startSongWorker();
  if (!consumerStarted) throw new Error('Song consumer did not start');
  logger.info('Standalone song worker started');
}

main().catch((err) => {
  logger.error({ err }, 'Standalone song worker startup failed');
  process.exit(1);
});
