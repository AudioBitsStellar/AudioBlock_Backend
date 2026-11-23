import { Repository } from 'typeorm';
import AppDataSource from '../config/db';
import { EmailSuppression, EmailSuppressionReason } from '../entities/EmailSuppression';

export type EmailEventSource = 'resend' | 'sendgrid';

export interface SuppressionEvent {
  email: string;
  reason: EmailSuppressionReason;
  source: EmailEventSource;
}

const MAX_EMAIL_LENGTH = 320;

/** Trims and lower-cases an address so suppression lookups ignore case. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function asAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = normalizeEmail(value);
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !email.includes('@')) {
    return null;
  }
  return email;
}

/**
 * SendGrid posts an array of events: `[{ event, email }]`.
 * Only bounces, spam reports and provider drops suppress an address. Deferred
 * (soft) bounces are retried by SendGrid, so they are ignored here.
 */
function parseSendGridEvent(event: unknown): SuppressionEvent[] {
  if (!event || typeof event !== 'object') return [];
  const { event: type, email } = event as { event?: unknown; email?: unknown };
  const address = asAddress(email);
  if (!address) return [];

  const source: EmailEventSource = 'sendgrid';
  switch (type) {
    case 'bounce':
      return [{ email: address, reason: EmailSuppressionReason.BOUNCE, source }];
    case 'spamreport':
      return [{ email: address, reason: EmailSuppressionReason.COMPLAINT, source }];
    case 'dropped':
      return [{ email: address, reason: EmailSuppressionReason.PROVIDER_DROP, source }];
    default:
      return [];
  }
}

/**
 * Resend posts one event: `{ type, data: { to: string[], bounce?: { type } } }`.
 * Only permanent bounces suppress. A transient bounce is retried by the provider,
 * and an undetermined bounce is not treated as a dead address.
 */
function parseResendEvent(event: Record<string, unknown>): SuppressionEvent[] {
  const data = event.data as { to?: unknown; bounce?: { type?: unknown } } | undefined;
  if (!data || typeof data !== 'object') return [];

  const recipients: unknown[] = Array.isArray(data.to) ? data.to : [data.to];
  const addresses = recipients
    .map(asAddress)
    .filter((address): address is string => address !== null);
  const source: EmailEventSource = 'resend';

  if (event.type === 'email.bounced') {
    if (data.bounce?.type !== 'Permanent') return [];
    return addresses.map((email) => ({ email, reason: EmailSuppressionReason.BOUNCE, source }));
  }
  if (event.type === 'email.complained') {
    return addresses.map((email) => ({ email, reason: EmailSuppressionReason.COMPLAINT, source }));
  }
  return [];
}

/**
 * Turns a raw provider webhook body into suppression events. Events that should
 * not suppress anything, and malformed entries, produce no output. The webhook
 * can therefore acknowledge every delivery with a 200.
 */
export function parseEmailEvents(body: unknown): SuppressionEvent[] {
  if (Array.isArray(body)) {
    return body.flatMap((event) => parseSendGridEvent(event));
  }
  if (body && typeof body === 'object') {
    return parseResendEvent(body as Record<string, unknown>);
  }
  return [];
}

/** Reads and writes the `email_suppressions` table. */
export class EmailSuppressionService {
  private get repo(): Repository<EmailSuppression> {
    return AppDataSource.getRepository(EmailSuppression);
  }

  /** True when transactional email to this address must be skipped. */
  async isSuppressed(email: string): Promise<boolean> {
    const count = await this.repo.count({ where: { email: normalizeEmail(email) } });
    return count > 0;
  }

  /** Records a suppression. Re-reporting an address updates its latest reason. */
  async suppress(event: SuppressionEvent): Promise<void> {
    await this.repo.upsert(
      {
        email: normalizeEmail(event.email),
        reason: event.reason,
        source: event.source,
      },
      { conflictPaths: ['email'] },
    );
  }
}
