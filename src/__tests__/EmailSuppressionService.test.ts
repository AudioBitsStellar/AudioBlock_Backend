import 'reflect-metadata';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

import { EmailSuppressionReason } from '../entities/EmailSuppression';
import { parseEmailEvents } from '../services/EmailSuppressionService';

const { BOUNCE, COMPLAINT, PROVIDER_DROP } = EmailSuppressionReason;

describe('parseEmailEvents (SendGrid)', () => {
  it('maps bounce, spamreport and dropped events and ignores the rest', () => {
    const body = [
      { event: 'bounce', email: 'Bounced@Example.com', type: 'bounce' },
      { event: 'open', email: 'opened@example.com' },
      { event: 'spamreport', email: 'complainer@example.com' },
      { event: 'dropped', email: 'dropped@example.com', reason: 'Invalid' },
    ];

    expect(parseEmailEvents(body)).toEqual([
      { email: 'bounced@example.com', reason: BOUNCE, source: 'sendgrid' },
      { email: 'complainer@example.com', reason: COMPLAINT, source: 'sendgrid' },
      { email: 'dropped@example.com', reason: PROVIDER_DROP, source: 'sendgrid' },
    ]);
  });

  it('does not suppress deferred (soft) bounces', () => {
    expect(parseEmailEvents([{ event: 'deferred', email: 'soft@example.com' }])).toEqual([]);
  });

  it('skips entries with a missing or malformed address', () => {
    const body = [
      { event: 'bounce' },
      { event: 'bounce', email: 'not-an-address' },
      { event: 'bounce', email: 42 },
      null,
    ];
    expect(parseEmailEvents(body)).toEqual([]);
  });
});

describe('parseEmailEvents (Resend)', () => {
  it('suppresses permanent bounces for every recipient', () => {
    const body = {
      type: 'email.bounced',
      data: { to: ['First@Example.com', 'second@example.com'], bounce: { type: 'Permanent' } },
    };
    expect(parseEmailEvents(body)).toEqual([
      { email: 'first@example.com', reason: BOUNCE, source: 'resend' },
      { email: 'second@example.com', reason: BOUNCE, source: 'resend' },
    ]);
  });

  it('does not suppress transient or undetermined bounces', () => {
    const transient = {
      type: 'email.bounced',
      data: { to: ['a@b.com'], bounce: { type: 'Transient' } },
    };
    const undetermined = {
      type: 'email.bounced',
      data: { to: ['a@b.com'], bounce: { type: 'Undetermined' } },
    };
    expect(parseEmailEvents(transient)).toEqual([]);
    expect(parseEmailEvents(undetermined)).toEqual([]);
  });

  it('maps complaints', () => {
    const body = { type: 'email.complained', data: { to: ['c@example.com'] } };
    expect(parseEmailEvents(body)).toEqual([
      { email: 'c@example.com', reason: COMPLAINT, source: 'resend' },
    ]);
  });

  it('ignores unrelated event types and malformed payloads', () => {
    expect(parseEmailEvents({ type: 'email.delivered', data: { to: ['a@b.com'] } })).toEqual([]);
    expect(parseEmailEvents({ type: 'email.bounced' })).toEqual([]);
    expect(parseEmailEvents('a string')).toEqual([]);
    expect(parseEmailEvents(undefined)).toEqual([]);
  });
});
