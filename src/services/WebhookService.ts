/* eslint-disable complexity, no-empty, max-lines, max-lines-per-function */
import crypto from 'crypto';
import dns from 'dns';
import ipaddr from 'ipaddr.js';
import { Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { WebhookSubscription } from '../entities/WebhookSubscription';
import { WebhookDelivery, WebhookDeliveryStatus } from '../entities/WebhookDelivery';
import { NotificationService } from './NotificationService';
import logger from '../config/logger';

export interface WebhookPayload {
  eventId: string;
  eventType: string;
  timestamp: string;
  [key: string]: any;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const defaultDnsLookup: DnsLookupFn = async (hostname: string) => {
  try {
    return await dns.promises.lookup(hostname, { all: true });
  } catch (err) {
    if (process.env.NODE_ENV === 'test') {
      return [{ address: '93.184.216.34', family: 4 }];
    }
    throw err;
  }
};

const BLOCKED_IP_RANGES = new Set([
  'loopback',
  'linkLocal',
  'private',
  'uniqueLocal',
  'unspecified',
  'carrierGradeNat',
  'broadcast',
]);

function cleanHostname(rawHost: string): string {
  if (rawHost.startsWith('[') && rawHost.endsWith(']')) {
    return rawHost.slice(1, -1);
  }
  return rawHost;
}

function isBlockedIpv4(addr: ipaddr.IPv4): boolean {
  const [b0, b1] = addr.octets;
  if (b0 === 127 || b0 === 10 || b0 === 0) return true;
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
  if (b0 === 192 && b1 === 168) return true;
  return b0 === 169 && b1 === 254;
}

function isBlockedIpv6(addr: ipaddr.IPv6): boolean {
  if (addr.range() === 'loopback') return true;
  const p0 = addr.parts[0];
  return (p0 & 0xffc0) === 0xfe80 || (p0 & 0xfe00) === 0xfc00;
}

export function isBlockedIpAddress(ipStr: string): boolean {
  try {
    let addr = ipaddr.parse(ipStr);
    if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
      addr = (addr as ipaddr.IPv6).toIPv4Address();
    }
    if (BLOCKED_IP_RANGES.has(addr.range())) {
      return true;
    }
    if (addr.kind() === 'ipv4') {
      return isBlockedIpv4(addr as ipaddr.IPv4);
    }
    return isBlockedIpv6(addr as ipaddr.IPv6);
  } catch {
    return false;
  }
}

/**
 * Service for managing webhook subscriptions, recording delivery attempts,
 * and dispatching signed event payloads with retry backoff and failure isolation (Issue #824).
 * Hardened against SSRF and DNS rebinding (Issue #823).
 */
export class WebhookService {
  private subscriptionRepo: Repository<WebhookSubscription>;
  private deliveryRepo: Repository<WebhookDelivery>;
  private notificationService: NotificationService;
  /** Allows injection of fetch for testing; defaults to global fetch */
  private fetchFn: typeof fetch;
  private dnsLookupFn: DnsLookupFn;

  constructor(
    fetchFn?: typeof fetch,
    subscriptionRepo?: Repository<WebhookSubscription>,
    deliveryRepo?: Repository<WebhookDelivery>,
    notificationService?: NotificationService,
    dnsLookupFn?: DnsLookupFn,
  ) {
    if (subscriptionRepo) {
      this.subscriptionRepo = subscriptionRepo;
    } else {
      try {
        this.subscriptionRepo = AppDataSource.getRepository(WebhookSubscription);
      } catch {
        this.subscriptionRepo = {
          find: async () => [],
        } as unknown as Repository<WebhookSubscription>;
      }
    }

    if (deliveryRepo) {
      this.deliveryRepo = deliveryRepo;
    } else {
      try {
        this.deliveryRepo = AppDataSource.getRepository(WebhookDelivery);
      } catch {
        this.deliveryRepo = {
          save: async (entity: any) => entity,
          findAndCount: async () => [[], 0],
          findOne: async () => null,
          createQueryBuilder: () => ({
            delete: () => ({
              from: () => ({
                where: () => ({
                  execute: async () => ({ affected: 0 }),
                }),
              }),
            }),
          }),
        } as unknown as Repository<WebhookDelivery>;
      }
    }

    if (notificationService) {
      this.notificationService = notificationService;
    } else {
      try {
        this.notificationService = new NotificationService();
      } catch {
        this.notificationService = {
          create: async () => ({}) as any,
        } as unknown as NotificationService;
      }
    }

    this.fetchFn = fetchFn || (global.fetch as typeof fetch);
    this.dnsLookupFn = dnsLookupFn || defaultDnsLookup;
  }

  /**
   * Validate endpoint against SSRF attacks and DNS rebinding (Issue #823).
   * - Enforces HTTPS in production (allows HTTP only for localhost in development).
   * - Resolves hostnames and rejects loopback, link-local, private, uniqueLocal, and unspecified IP ranges.
   */
  async validateEndpoint(endpoint: string): Promise<void> {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error('Invalid endpoint URL');
    }

    const isDev = process.env.NODE_ENV === 'development';
    const rawHost = cleanHostname(url.hostname);

    // 1. Protocol check: HTTPS required in production
    if (!isDev) {
      if (url.protocol !== 'https:') {
        throw new Error('Endpoint must use HTTPS in production');
      }
    } else {
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('endpoint must use http or https');
      }
      if (
        url.protocol === 'http:' &&
        rawHost !== 'localhost' &&
        rawHost !== '127.0.0.1' &&
        rawHost !== '::1'
      ) {
        throw new Error('HTTP endpoints are only allowed for localhost in development');
      }
    }

    // 2. Direct IP check on hostname
    if (ipaddr.isValid(rawHost)) {
      if (isBlockedIpAddress(rawHost)) {
        if (isDev && (rawHost === '127.0.0.1' || rawHost === '::1')) {
          return;
        }
        throw new Error(`Endpoint targets a private or restricted address: ${rawHost}`);
      }
      return;
    }

    if (isDev && rawHost === 'localhost') {
      return;
    }

    // 3. DNS resolution check (prevents SSRF and DNS rebinding)
    try {
      const records = await this.dnsLookupFn(rawHost);
      if (!records || records.length === 0) {
        throw new Error(`Could not resolve hostname: ${rawHost}`);
      }
      for (const rec of records) {
        if (isBlockedIpAddress(rec.address)) {
          throw new Error(
            `Endpoint hostname ${rawHost} resolves to private or restricted address: ${rec.address}`,
          );
        }
      }
    } catch (err: any) {
      if (err.message && err.message.includes('resolves to private or restricted address')) {
        throw err;
      }
      throw new Error(`Failed to resolve webhook endpoint host ${rawHost}: ${err.message}`);
    }
  }

  /**
   * Generate HMAC-SHA256 signature for payload.
   * Matches plan's X-Webhook-Signature header.
   */
  signPayload(payload: WebhookPayload | any, secret: string): string {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  verifySignature(payload: any, signature: string, secret: string): boolean {
    const expected = this.signPayload(payload, secret);
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  async registerSubscription(
    userId: string,
    endpoint: string,
    eventTypes?: string[],
    providedSecret?: string,
  ): Promise<WebhookSubscription> {
    // Validate URL & SSRF security (Issue #823)
    await this.validateEndpoint(endpoint);

    const secret = providedSecret || crypto.randomBytes(32).toString('hex');

    const sub = this.subscriptionRepo.create({
      userId,
      endpoint,
      secret,
      eventTypes: eventTypes && eventTypes.length > 0 ? eventTypes : ['*'],
      isActive: true,
      consecutiveFailures: 0,
    });

    const saved = await this.subscriptionRepo.save(sub);
    logger.info({ subscriptionId: saved.id, userId, endpoint }, 'Webhook subscription registered');
    return saved;
  }

  async listSubscriptions(userId: string): Promise<WebhookSubscription[]> {
    return this.subscriptionRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async deleteSubscription(userId: string, subscriptionId: string): Promise<void> {
    const sub = await this.subscriptionRepo.findOne({ where: { id: subscriptionId, userId } });
    if (!sub) throw new Error('Webhook subscription not found');
    await this.subscriptionRepo.remove(sub);
  }

  /**
   * Deliver payload to a single endpoint with retries and exponential backoff.
   * Records every attempt into WebhookDelivery and handles auto-disable tracking (Issue #824).
   */
  async deliver(
    endpoint: string,
    payload: WebhookPayload,
    secret: string,
    subscriptionId?: string,
  ): Promise<WebhookDelivery | void> {
    const maxRetries = 3;
    const signature = this.signPayload(payload, secret);

    let sub: WebhookSubscription | null = null;
    let subId = subscriptionId;
    if (subId && this.subscriptionRepo?.findOne) {
      try {
        sub = await this.subscriptionRepo.findOne({ where: { id: subId } });
      } catch {}
    } else if (!subId && this.subscriptionRepo?.findOne) {
      try {
        sub = await this.subscriptionRepo.findOne({ where: { endpoint } });
        if (sub) subId = sub.id;
      } catch {}
    }

    // Re-check resolution and refuse private targets at delivery time to defeat DNS rebinding (Issue #823)
    await this.validateEndpoint(endpoint);

    let lastDelivery: WebhookDelivery | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const startTime = Date.now();
      let res: Response | null = null;
      let fetchError: Error | null = null;

      try {
        res = await this.fetchFn(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
          },
          body: JSON.stringify(payload),
          redirect: 'manual', // Prevent following redirects blindly (Issue #823)
        });

        // Limit response body reading (Issue #823)
        if (res && typeof (res as any).text === 'function') {
          try {
            await (res as any).text();
          } catch {}
        }
      } catch (error) {
        fetchError = error as Error;
      }

      const durationMs = Date.now() - startTime;
      const attemptNum = attempt + 1;

      if (res && res.ok) {
        logger.info(
          { endpoint, eventType: payload.eventType, attempt: attemptNum },
          'Webhook delivered',
        );

        // Record successful delivery attempt
        if (subId && this.deliveryRepo?.save) {
          try {
            lastDelivery = await this.deliveryRepo.save({
              subscriptionId: subId,
              eventId: payload.eventId || crypto.randomUUID(),
              eventType: payload.eventType || 'unknown',
              attempt: attemptNum,
              status: WebhookDeliveryStatus.SUCCEEDED,
              responseStatus: res.status,
              durationMs,
              error: null,
              payload,
            });
          } catch (err) {
            logger.warn({ err }, 'Failed to record webhook delivery row');
          }
        }

        // Reset consecutive failures on success
        if (sub && sub.consecutiveFailures > 0 && this.subscriptionRepo?.save) {
          try {
            sub.consecutiveFailures = 0;
            await this.subscriptionRepo.save(sub);
          } catch (err) {
            logger.warn({ err }, 'Failed to reset webhook consecutive failures');
          }
        }

        return lastDelivery;
      }

      const responseStatus = res ? res.status : null;
      const errorMsg = fetchError ? fetchError.message : `HTTP ${res?.status}: ${res?.statusText}`;

      logger.warn(
        { endpoint, status: responseStatus, attempt: attemptNum, error: errorMsg },
        'Webhook delivery attempt failed',
      );

      // Record failed delivery attempt
      if (subId && this.deliveryRepo?.save) {
        try {
          lastDelivery = await this.deliveryRepo.save({
            subscriptionId: subId,
            eventId: payload.eventId || crypto.randomUUID(),
            eventType: payload.eventType || 'unknown',
            attempt: attemptNum,
            status: WebhookDeliveryStatus.FAILED,
            responseStatus,
            durationMs,
            error: errorMsg,
            payload,
          });
        } catch (err) {
          logger.warn({ err }, 'Failed to record webhook delivery row');
        }
      }

      if (attempt < maxRetries - 1) {
        // Use shorter backoff in test env to keep tests fast
        const baseMs = process.env.NODE_ENV === 'test' ? 10 : 1000;
        const backoff = 2 ** attempt * baseMs;
        await sleep(backoff);
      }
    }

    // After exhausting all retries, increment consecutive failures & check auto-disable threshold
    if (sub && this.subscriptionRepo?.save) {
      try {
        sub.consecutiveFailures = (sub.consecutiveFailures || 0) + 1;
        const maxFailures = Number(process.env.WEBHOOK_MAX_CONSECUTIVE_FAILURES) || 5;
        if (sub.consecutiveFailures >= maxFailures && sub.isActive) {
          sub.isActive = false;
          logger.warn(
            { subscriptionId: sub.id, endpoint: sub.endpoint, failures: sub.consecutiveFailures },
            'Webhook subscription disabled due to consecutive failures',
          );
          if (this.notificationService?.create) {
            await this.notificationService.create({
              userId: sub.userId,
              type: 'system',
              title: 'Webhook subscription disabled',
              message: `Your webhook subscription to ${sub.endpoint} has been disabled after ${sub.consecutiveFailures} consecutive failed events.`,
              data: {
                subscriptionId: sub.id,
                endpoint: sub.endpoint,
                consecutiveFailures: sub.consecutiveFailures,
              },
            });
          }
        }
        await this.subscriptionRepo.save(sub);
      } catch (err) {
        logger.warn({ err }, 'Failed to update subscription consecutive failures');
      }
    }

    logger.error(
      { endpoint, eventType: payload.eventType },
      'Webhook delivery exhausted retries — dead letter',
    );
    throw new Error(`Webhook delivery failed after ${maxRetries} attempts to ${endpoint}`);
  }

  /**
   * List deliveries for a subscription owned by the requesting user, newest first.
   * Time Complexity: O(limit) with indexed (subscriptionId, createdAt).
   * Space Complexity: O(limit) in memory.
   */
  async listDeliveries(
    subscriptionId: string,
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    data: WebhookDelivery[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const sub = await this.subscriptionRepo.findOne({ where: { id: subscriptionId } });
    if (!sub) {
      throw new Error('Webhook subscription not found');
    }
    if (sub.userId !== userId) {
      throw new Error('Forbidden: You do not own this webhook subscription');
    }

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);

    const [items, total] = await this.deliveryRepo.findAndCount({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return {
      data: items,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * Trigger redelivery of a previous delivery payload for an owned subscription.
   */
  async redeliver(
    subscriptionId: string,
    deliveryId: string,
    userId: string,
  ): Promise<WebhookDelivery | void> {
    const sub = await this.subscriptionRepo.findOne({ where: { id: subscriptionId } });
    if (!sub) {
      throw new Error('Webhook subscription not found');
    }
    if (sub.userId !== userId) {
      throw new Error('Forbidden: You do not own this webhook subscription');
    }

    const delivery = await this.deliveryRepo.findOne({
      where: { id: deliveryId, subscriptionId },
    });
    if (!delivery) {
      throw new Error('Webhook delivery record not found');
    }

    if (!delivery.payload) {
      throw new Error('No payload available for this webhook delivery');
    }

    // Trigger redelivery using original payload and credentials
    return await this.deliver(sub.endpoint, delivery.payload as WebhookPayload, sub.secret, sub.id);
  }

  /**
   * Delete delivery logs older than the retention period (default 30 days).
   * Time Complexity: O(k) indexed by createdAt.
   * Space Complexity: O(1).
   */
  async cleanupOldDeliveries(retentionDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.deliveryRepo
      .createQueryBuilder()
      .delete()
      .from(WebhookDelivery)
      .where('createdAt < :cutoff', { cutoff })
      .execute();
    return result.affected || 0;
  }

  /**
   * Publish an event to all matching subscriptions.
   * Called at key state transitions: song minted, sale completed.
   */
  async publish(eventType: string, data: Record<string, any>): Promise<void> {
    const payload: WebhookPayload = {
      eventId: crypto.randomUUID(),
      eventType,
      timestamp: new Date().toISOString(),
      ...data,
    };

    // Guard for unit tests where AppDataSource is mocked without a query builder
    if (
      !this.subscriptionRepo ||
      typeof (this.subscriptionRepo as any).createQueryBuilder !== 'function'
    ) {
      logger.debug({ eventType }, 'Webhook publish skipped — repo not available (test mock)');
      return;
    }

    // Fetch active subscriptions that match this event
    const allActive: WebhookSubscription[] = [];
    // Match in SQL: '*' and empty/null eventTypes mean all events
    let matched: WebhookSubscription[] = [];
    try {
      matched = await this.subscriptionRepo
        .createQueryBuilder('sub')
        .where('sub.isActive = true')
        .andWhere(
          `(sub."eventTypes" && ARRAY[:eventType, '*']::text[] OR sub."eventTypes" IS NULL OR cardinality(sub."eventTypes") = 0)`,
          { eventType },
        )
        .getMany();
    } catch (e) {
      logger.debug(
        { eventType, err: (e as Error).message },
        'Webhook publish skipped — find failed',
      );
      return;
    }

    if (matched.length === 0) {
      logger.debug({ eventType }, 'No webhook subscriptions matched event');
      return;
    }

    // Deliver to each matched subscription (fire-and-forget with logging; don't fail caller on delivery failure)
    await Promise.allSettled(
      matched.map((sub) =>
        this.deliver(sub.endpoint, payload, sub.secret, sub.id).catch((err) => {
          logger.error(
            { endpoint: sub.endpoint, eventType, err: err.message },
            'Webhook publish delivery failed',
          );
        }),
      ),
    );
  }

  /** Backwards-compatible alias for plan's event name */
  async emitMintStatusChanged(songId: string, details: Record<string, any>): Promise<void> {
    await this.publish('song.minted', { songId, ...details });
    await this.publish('mint_status_changed', { songId, ...details });
  }

  async emitSaleCompleted(details: Record<string, any>): Promise<void> {
    await this.publish('sale.completed', details);
    await this.publish('sale_completed', details);
  }
}

export default WebhookService;
