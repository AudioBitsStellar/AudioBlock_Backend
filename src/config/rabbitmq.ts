import amqp from 'amqplib';
import { isShuttingDown } from '../utils/gracefulShutdown';
import logger from './logger';

let connection: Awaited<ReturnType<typeof amqp.connect>> | null = null;
let stopping = false;
let retryTimer: NodeJS.Timeout | undefined;

export async function closeRabbitMQConnection(): Promise<void> {
  stopping = true;
  if (retryTimer) clearTimeout(retryTimer);
  const current = connection;
  connection = null;
  channel = null;
  if (current) await current.close();
}

let channel: amqp.Channel | null = null;

export async function initRabbitMQ(): Promise<void> {
  const connect = async () => {
    if (stopping || isShuttingDown()) return;
    try {
      const rabbitmqUrl = process.env.RABBITMQ_URL;

      if (!rabbitmqUrl) {
        throw new Error('RABBITMQ_URL environment variable is required');
      }

      logger.info('Connecting to RabbitMQ');

      // For amqps://, no additional config needed - amqplib handles TLS automatically
      const connected = await amqp.connect(rabbitmqUrl, {
        heartbeat: 60,
        // ssl: { rejectUnauthorized: false }
      } as any);

      connection = connected;
      if (stopping || isShuttingDown()) {
        await closeRabbitMQConnection();
        return;
      }
      channel = await connected.createChannel();
      logger.info('RabbitMQ connected and channel created');

      connected.on('close', () => {
        logger.warn('RabbitMQ connection closed, retrying...');
        channel = null;
        if (!stopping && !isShuttingDown()) retryTimer = setTimeout(connect, 5000);
      });

      connected.on('error', (err) => {
        logger.error({ err }, 'RabbitMQ connection error');
      });
    } catch (error: any) {
      logger.error({ err: error }, 'RabbitMQ connection failed');
      channel = null;
      if (!stopping && !isShuttingDown()) retryTimer = setTimeout(connect, 5000);
    }
  };

  await connect();
}

export const MAIN_QUEUE = 'song_processing';
export const DLQ = 'song_processing_dlq';

export function getChannel(): amqp.Channel {
  if (!channel) throw new Error('RabbitMQ not initialized');
  return channel;
}

export function getRawChannel(): amqp.Channel | null {
  return channel;
}

export function isConnected(): boolean {
  return channel !== null;
}
