import { Router, Request, Response } from 'express';
import logger from '../config/logger';

const router = Router();

/**
 * SSE channel for live on-chain activity.
 *
 * Clients connect via GET /api/activity/onchain/stream and receive
 * real-time events as they are indexed from the Stellar ledger.
 *
 * Events are pushed by the indexer worker publishing to Redis pub/sub.
 * This endpoint subscribes and forwards each event to connected clients.
 *
 * Connection survives a single dropped event gracefully (clients auto-reconnect).
 *
 * Example client:
 * ```js
 * const es = new EventSource('/api/activity/onchain/stream');
 * es.onmessage = (e) => {
 *   const event = JSON.parse(e.data);
 *   console.log('New activity:', event);
 * };
 * es.onerror = () => {
 *   // EventSource auto-reconnects after a short delay
 *   console.log('Connection lost, reconnecting...');
 * };
 * ```
 */

// In-memory set of connected SSE clients.
// For production, consider using Redis pub/sub fanout across instances.
const clients = new Set<Response>();

// Called by the indexer worker to push events to all connected SSE clients.
export function broadcastOnChainEvent(event: Record<string, unknown>): void {
  const data = JSON.stringify(event);
  for (const client of clients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      // Client disconnected; will be cleaned up on 'close' listener
      clients.delete(client);
    }
  }
}

router.get('/onchain/stream', (req: Request, res: Response) => {
  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  // Send initial keepalive comment so the connection isn't considered idle
  res.write(':ok\n\n');

  // Register client
  clients.add(res);
  logger.info({ totalClients: clients.size }, 'SSE client connected to onchain stream');

  // Heartbeat to detect dead connections
  const heartbeat = setInterval(() => {
    try {
      res.write(':heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
      clients.delete(res);
    }
  }, 15000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    logger.info({ totalClients: clients.size }, 'SSE client disconnected from onchain stream');
  });
});

export default router;
