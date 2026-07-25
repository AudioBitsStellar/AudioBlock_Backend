import 'reflect-metadata';
import app from './app';
import AppDataSource from './config/db';
import { initRabbitMQ } from './config/rabbitmq';
import { startSongWorker } from './workers/SongProcessorWorker';
import fs from 'fs';
import path from 'path';
import { runSeeders } from './seeders';
import { validateSorobanConfig } from './config/soroban';
import { validateEnvironment } from './config/env';
import { startDbPoolMonitor } from './services/DbPoolMonitor';
import { startJobQueueWorker, startJobQueueMonitor } from './workers/JobQueueWorker';
import logger from './config/logger';
import { startConnectionStateLogger } from './services/DatabaseConnectionManager';

// Ensure upload directories exist
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

    // Initialize the database connection
    await AppDataSource.initialize();
    logger.info('Database connected successfully');

    // Start connection-pool metrics + health monitoring (Issue #134)
    startDbPoolMonitor(AppDataSource);

    // Start connection state logging (Issue #127)
    startConnectionStateLogger();

    // Run Seeders
    await runSeeders();

    // Create upload directories
    uploadDirs.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`Created directory: ${dir}`);
      }
    });

    // START THE SERVER FIRST - This is critical for Render
    const PORT = process.env.PORT || 4000;
    const server = app.listen(PORT, () => {
      logger.info(`Server is listening on port ${PORT}`);
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use`);
      } else {
        logger.error({ err: error }, 'Server error');
      }
      process.exit(1);
    });

    // Start the background job queue worker + depth monitor (Issue #132).
    // Backed by Redis, independent of RabbitMQ.
    startJobQueueWorker();
    startJobQueueMonitor();

    // Initialize RabbitMQ in background (non-blocking)
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
  } catch (error) {
    logger.error({ err: error }, 'Failed to start the server');
    process.exit(1);
  }
}

process.on('uncaughtException', (error) => {
  logger.error({ err: error }, 'Uncaught Exception');
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise: String(promise) }, 'Unhandled Rejection');
  process.exit(1);
});

main();
