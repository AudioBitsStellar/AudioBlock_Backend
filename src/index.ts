import 'reflect-metadata';
import app from './app';
import AppDataSource from './config/db';
import { initRabbitMQ } from './config/rabbitmq';
import { startSongWorker } from './workers/SongProcessorWorker';
import fs from 'fs';
import { runSeeders } from './seeders';
import { validateSorobanConfig } from './config/soroban';
import { validateEnvironment } from './config/env';
import { startDbPoolMonitor } from './services/DbPoolMonitor';
import { startJobQueueWorker, startJobQueueMonitor } from './workers/JobQueueWorker';
import { registerAiJobHandlers } from './workers/AiJobHandlers';
import logger from './config/logger';
import { startConnectionStateLogger } from './services/DatabaseConnectionManager';
import {
  attachProcessHandlers,
  closeRedis,
  closeDatabase,
  drainWorkerQueues,
  registerServer,
  registerShutdownHook,
} from './utils/gracefulShutdown';

const uploadDirs = [
  'uploads/temp',
  'uploads/merged',
  'uploads/profile-images',
  'uploads/page-covers',
  'uploads/covers',
];

async function main() {
  try {
    validateEnvironment();
    validateSorobanConfig();

    await AppDataSource.initialize();
    logger.info('Database connected successfully');

    startDbPoolMonitor(AppDataSource);

    // Start connection state logging (Issue #127)
    startConnectionStateLogger();

    // Run Seeders
    await runSeeders();

    uploadDirs.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`Created directory: ${dir}`);
      }
    });

    const PORT = process.env.PORT || 4000;
    const server = app.listen(PORT, () => {
      logger.info(`Server is listening on port ${PORT}`);
    });

    registerServer(server);

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`);
      } else {
        logger.error({ err: error }, 'Server error');
      }
      process.exit(1);
    });

    registerAiJobHandlers();
    startJobQueueWorker();
    startJobQueueMonitor();

    initRabbitMQ()
      .then(() => {
        logger.info('RabbitMQ initialized, starting workers');
        startSongWorker();
        logger.info('Background workers started');
      })
      .catch((err) => {
        logger.error({ err }, 'RabbitMQ initialization failed');
        logger.warn('Server running without workers');
      });

    registerShutdownHook('database', closeDatabase);
    registerShutdownHook('redis', closeRedis);
    registerShutdownHook('worker-queues', drainWorkerQueues);

    attachProcessHandlers();
  } catch (error) {
    logger.error({ err: error }, 'Failed to start the server');
    process.exit(1);
  }
}

main();
